import { expect, it } from 'vitest';
import { SqliteD1 } from './testSqliteD1';
import { archiveHistoryPage, hydrateHistoryRow, restoreHistoryRow } from '../../experiments/better-auth/history-archive';

class Bucket {
  objects = new Map<string, string>();
  puts = 0; gets = 0;
  failPut = false; corrupt = false;
  afterGet: (() => void) | undefined;
  async put(key: string, body: string) { this.puts++; if (this.failPut) throw Error('R2 unavailable'); this.objects.set(key, body); }
  async get(key: string) {
    this.gets++; const text = this.objects.get(key); this.afterGet?.();
    return text === undefined ? null : { size: new TextEncoder().encode(text).length, text: async () => this.corrupt ? '{}' : text };
  }
}
const setup = () => {
  const db = new SqliteD1();
  db.db.exec('ALTER TABLE resource_changes ADD COLUMN archive_key TEXT; ALTER TABLE resource_changes ADD COLUMN archive_digest TEXT');
  const snapshot = JSON.stringify({ id:'sim', name:'Synthetic', ownerUserId:'owner', visibility:'private', sharedWith:[], snapshot:{sites:[], padding:'x'.repeat(4096)} });
  const details = JSON.stringify({ changedFields:['snapshot','visibility'], diff:{snapshot:{before:{old:true},after:JSON.parse(snapshot).snapshot},visibility:{before:'public',after:'private'},sharedWith:{before:[{userId:'reader',role:'viewer'}],after:[]}} });
  db.db.exec("INSERT INTO users(id,username) VALUES('owner','owner'),('reader','reader')");
  db.db.prepare("INSERT INTO resource_changes(id,resource_kind,resource_id,action,actor_user_id,changed_at,note,details_json,snapshot_json) VALUES(1,'simulation','sim','updated','owner','2026-09-17','Updated',?,?)").run(details,snapshot);
  const bucket = new Bucket();
  const env = { DB:db as unknown as D1Database, BUCKET:bucket as unknown as R2Bucket, scope:'synthetic-staging' };
  const row = () => db.db.prepare('SELECT * FROM resource_changes WHERE id=1').get()!;
  return {db,bucket,env,row,snapshot,details};
};
it('defaults to dry run, copies and verifies before CAS, repeats safely and restores exact originals', async () => {
  const f=setup();try {
    expect(await archiveHistoryPage(f.env)).toMatchObject({candidates:1,converted:0});expect(f.bucket.puts).toBe(0);
    expect(await archiveHistoryPage(f.env,{apply:true})).toMatchObject({converted:1,conflicts:0});
    expect(f.row().snapshot_json).not.toContain('padding');expect(JSON.parse(String(f.row().details_json)).diff.snapshot).toBeUndefined();
    const decoded=await hydrateHistoryRow(f.env,1);expect(decoded).toMatchObject({snapshot_json:f.snapshot,details_json:f.details});
    expect(await archiveHistoryPage(f.env,{apply:true})).toMatchObject({converted:0});
    expect(await restoreHistoryRow(f.env,1)).toBe(true);expect(f.row()).toMatchObject({snapshot_json:f.snapshot,details_json:f.details,archive_key:null});
    expect(f.bucket.objects.size).toBe(1); // No eager deletion: retained for in-flight readers / backup rollback.
  }finally{f.db.db.close();}
});
it('leaves D1 intact on upload, verification, missing object and integrity failure', async () => {
  const f=setup();try {
    f.bucket.failPut=true;await expect(archiveHistoryPage(f.env,{apply:true})).rejects.toThrow();expect(f.row().snapshot_json).toBe(f.snapshot);
    f.bucket.failPut=false;f.bucket.corrupt=true;await expect(archiveHistoryPage(f.env,{apply:true})).rejects.toThrow();expect(f.row().archive_key).toBeNull();
    f.bucket.corrupt=false;await archiveHistoryPage(f.env,{apply:true});
    f.bucket.corrupt=true;await expect(hydrateHistoryRow(f.env,1)).rejects.toThrow();
    f.bucket.objects.clear();await expect(restoreHistoryRow(f.env,1)).rejects.toThrow();expect(f.row().archive_key).not.toBeNull();
  }finally{f.db.db.close();}
});
it('does not overwrite concurrent archive/restore updates or claim foreign environment objects', async () => {
  const f=setup();try {
    f.bucket.afterGet=()=>f.db.db.prepare("UPDATE resource_changes SET snapshot_json=json_set(snapshot_json,'$.ownerUserId','new-owner') WHERE id=1").run();
    expect(await archiveHistoryPage(f.env,{apply:true})).toMatchObject({converted:0,conflicts:1});
    f.bucket.afterGet=undefined;await archiveHistoryPage(f.env,{apply:true});
    await expect(hydrateHistoryRow({...f.env,scope:'synthetic-production'},1)).rejects.toThrow();
    f.bucket.afterGet=()=>f.db.db.prepare("UPDATE resource_changes SET snapshot_json=json_set(snapshot_json,'$.ownerUserId','third-owner') WHERE id=1").run();
    expect(await restoreHistoryRow(f.env,1)).toBe(false);expect(f.row().snapshot_json).toContain('third-owner');
  }finally{f.db.db.close();}
});
it('keeps migrated metadata authoritative without changing immutable original details', async () => {
  const f=setup();try {
    await archiveHistoryPage(f.env,{apply:true});
    f.db.db.prepare("UPDATE resource_changes SET snapshot_json=json_set(snapshot_json,'$.ownerUserId','migrated','$.sharedWith',json(?)) WHERE id=1").run('[{"userId":"new-reader","role":"viewer"}]');
    const decoded=await hydrateHistoryRow(f.env,1);expect(JSON.parse(decoded!.snapshot_json!)).toMatchObject({ownerUserId:'migrated',sharedWith:[{userId:'new-reader',role:'viewer'}],snapshot:JSON.parse(f.snapshot).snapshot});
    expect(decoded!.details_json).toBe(f.details);
    const projection=f.db.db.prepare("SELECT json_extract(details_json,'$.diff.visibility.before') AS visibility,json_extract(details_json,'$.diff.sharedWith.before[0].userId') AS reader FROM resource_changes").get();
    expect(projection).toMatchObject({visibility:'public',reader:'reader'});
  }finally{f.db.db.close();}
});
it('rejects invalid bounds before touching bindings', async()=>{
  for(const options of [{limit:11},{limit:0},{afterId:-1}]) await expect(archiveHistoryPage({} as never,options)).rejects.toThrow();
});
it('preserves real Library recovery and authorized history listing, then supports revert after rollback', async()=>{
  const {fetchLibraryForUser,fetchResourceChanges,revertResourceFromChangeCopy}=await import('./db');
  const f=setup();try{
    f.db.db.prepare("INSERT INTO simulations(id,owner_user_id,name,visibility,status,payload_json,updated_at) VALUES('sim','owner','Synthetic','private','active',?,'2026-09-17')").run(f.snapshot);
    const env={DB:f.env.DB} as Parameters<typeof fetchLibraryForUser>[0];
    const actor={id:'owner',isAdmin:false,isModerator:false};
    f.db.db.prepare("INSERT INTO resource_changes(id,resource_kind,resource_id,action,actor_user_id,changed_at,note,snapshot_json) VALUES(2,'site','deleted-site','updated','owner','2026-09-17','Deleted Site',?)").run(JSON.stringify({id:'deleted-site',ownerUserId:'owner',visibility:'public',sharedWith:[],name:'Deleted synthetic Site'}));
    const before=await fetchLibraryForUser(env,'reader');
    expect(before.deletedSiteIds).toContain('deleted-site');
    expect(before.removedSimulationIds).toContain('sim');
    const history=await fetchResourceChanges(env,'simulation','sim',actor);
    await archiveHistoryPage(f.env,{apply:true});
    expect(await fetchLibraryForUser(env,'reader')).toEqual(before);
    expect(await fetchResourceChanges(env,'simulation','sim',actor)).toEqual(history);
    expect(await fetchResourceChanges(env,'simulation','sim',{...actor,id:'stranger'})).toMatchObject({ok:false,reason:'forbidden'});
    // Application revert is intentionally not wired to archive reads in this
    // prototype. A verified rollback restores its existing exact input contract.
    expect(await restoreHistoryRow(f.env,1)).toBe(true);
    expect(await revertResourceFromChangeCopy(env,'simulation','sim',1,actor)).toMatchObject({ok:true});
  }finally{f.db.db.close();}
});
it('one concurrent archiver wins and an ambiguous committed update keeps its object',async()=>{
  const f=setup();try{
    const results=await Promise.all([archiveHistoryPage(f.env,{apply:true}),archiveHistoryPage(f.env,{apply:true})]);
    expect(results.reduce((n,r)=>n+r.converted,0)).toBe(1);
    expect(await hydrateHistoryRow(f.env,1)).toMatchObject({snapshot_json:f.snapshot});
    await restoreHistoryRow(f.env,1);
    const originalPrepare=f.env.DB.prepare.bind(f.env.DB);
    const DB={prepare(sql:string){const stmt=originalPrepare(sql);const bind=stmt.bind.bind(stmt);stmt.bind=(...args:unknown[])=>{const bound=bind(...args);if(sql.startsWith('UPDATE resource_changes SET snapshot_json=')&&sql.includes('archive_key IS NULL')){const run=bound.run.bind(bound);bound.run=async()=>{await run();throw Error('lost response');};}return bound;};return stmt;}} as D1Database;
    await expect(archiveHistoryPage({...f.env,DB},{apply:true})).rejects.toThrow('lost response');
    expect(await hydrateHistoryRow(f.env,1)).toMatchObject({snapshot_json:f.snapshot});
  }finally{f.db.db.close();}
});

it('probe rejects anonymous and expired calls before reading any bindings',async()=>{
 const worker=(await import('../../experiments/better-auth/history-archive-worker')).default;
 for(const path of ['/archive','/hydrate','/restore','/cleanup']){
  expect((await worker.fetch(new Request('https://test'+path,{method:'POST'}),{} as never)).status).toBe(404);
  expect((await worker.fetch(new Request('https://test'+path,{method:'POST',headers:{authorization:'Bearer test'}}),{PROBE_ENABLED:'synthetic-history-r2',PROBE_KEY:'test',PROBE_EXPIRES_AT:'2020-01-01'} as never)).status).toBe(404);
 }
});
