import { expect, it } from 'vitest';
import { SqliteD1 } from './testSqliteD1';
import { archiveHistoryPage, copyArchivedHistoryRowForStaging, hydrateHistoryRow, restoreHistoryRow } from '../../experiments/better-auth/history-archive';
import { readAuthorizedArchivedHistory } from '../../experiments/better-auth/history-archive-authorized';

class Bucket {
  objects = new Map<string, string>();
  puts = 0; gets = 0; heads = 0;
  failPut = false; corrupt = false;
  afterGet: (() => void) | undefined;
  async put(key: string, body: string) { this.puts++; if (this.failPut) throw Error('R2 unavailable'); this.objects.set(key, body); }
  async head(key: string) { this.heads++; return this.objects.has(key) ? { size: this.objects.get(key)!.length } : null; }
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
it('preserves real Library recovery and authorized history listing, and reverts archived payloads', async()=>{
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
    await expect(revertResourceFromChangeCopy(env,'simulation','sim',1,actor)).rejects.toThrow(/archive binding/i);
    const archiveEnabledEnv={...env,HISTORY_BUCKET:f.env.BUCKET,HISTORY_SCOPE:'synthetic-staging'};
    expect(await revertResourceFromChangeCopy(archiveEnabledEnv,'simulation','sim',1,actor)).toMatchObject({ok:true});
    const reverted=f.db.db.prepare("SELECT payload_json FROM simulations WHERE id='sim'").get() as {payload_json:string};
    expect(JSON.parse(reverted.payload_json).snapshot.padding).toBe('x'.repeat(4096));
    expect(f.row().archive_key).not.toBeNull();
    expect(await restoreHistoryRow(f.env,1)).toBe(true);
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

it('an exact-row rehearsal cannot advance to a different history row after deletion', async () => {
  const f=setup();
  try {
    f.db.db.prepare("INSERT INTO resource_changes(id,resource_kind,resource_id,action,actor_user_id,changed_at,snapshot_json) VALUES(2,'simulation','real-sim','updated','real-user','2026-09-18',?)")
      .run(f.snapshot);
    f.db.db.prepare('DELETE FROM resource_changes WHERE id=1').run();
    const result=await archiveHistoryPage(f.env,{target:{id:1,resourceKind:'simulation',resourceId:'sim',actorUserId:'owner'},apply:true});
    expect(result).toMatchObject({scanned:0,converted:0});
    expect(f.db.db.prepare('SELECT archive_key FROM resource_changes WHERE id=2').get()).toEqual({archive_key:null});
    expect(f.bucket.puts).toBe(0);
  } finally { f.db.db.close(); }
});

it('an exact-row rehearsal loses the compare-and-swap if identity changes during upload', async () => {
  const f=setup();
  try {
    f.bucket.afterGet=()=>f.db.db.prepare("UPDATE resource_changes SET resource_id='different' WHERE id=1").run();
    const result=await archiveHistoryPage(f.env,{target:{id:1,resourceKind:'simulation',resourceId:'sim',actorUserId:'owner'},apply:true});
    expect(result).toMatchObject({scanned:1,converted:0,conflicts:1});
    expect(f.row().archive_key).toBeNull();
  } finally { f.db.db.close(); }
});

it('an exact-row restore leaves history archived if identity changes during hydration', async () => {
  const f=setup();
  try {
    await archiveHistoryPage(f.env,{target:{id:1,resourceKind:'simulation',resourceId:'sim',actorUserId:'owner'},apply:true});
    f.bucket.afterGet=()=>f.db.db.prepare("UPDATE resource_changes SET actor_user_id='different' WHERE id=1").run();
    expect(await restoreHistoryRow(f.env,1,{id:1,resourceKind:'simulation',resourceId:'sim',actorUserId:'owner'})).toBe(false);
    expect(f.row().archive_key).not.toBeNull();
  } finally { f.db.db.close(); }
});

it('probe rejects anonymous and expired calls before reading any bindings',async()=>{
 const worker=(await import('../../experiments/better-auth/history-archive-worker')).default;
 for(const path of ['/archive','/hydrate','/restore','/cleanup']){
  expect((await worker.fetch(new Request('https://test'+path,{method:'POST'}),{} as never)).status).toBe(404);
  expect((await worker.fetch(new Request('https://test'+path,{method:'POST',headers:{authorization:'Bearer test'}}),{PROBE_ENABLED:'synthetic-history-r2',PROBE_KEY:'test',PROBE_EXPIRES_AT:'2020-01-01'} as never)).status).toBe(404);
 }
});

it('hydrates only a change of the authorized resource and rechecks permission after the R2 read',async()=>{
 const f=setup();try{
  f.db.db.prepare("INSERT INTO simulations(id,owner_user_id,name,visibility,status,payload_json,updated_at) VALUES('sim','owner','Synthetic','private','active',?,'2026-09-17')").run(f.snapshot);
  f.db.db.prepare("INSERT INTO simulations(id,owner_user_id,name,visibility,status,payload_json,updated_at) VALUES('other','owner','Other','private','active',?,'2026-09-17')").run(f.snapshot);
  await archiveHistoryPage(f.env,{apply:true});
  const owner={id:'owner',isAdmin:false,isModerator:false};
  expect(await readAuthorizedArchivedHistory(f.env,'simulation','sim',1,owner)).toMatchObject({ok:true,row:{snapshot_json:f.snapshot}});
  const gets=f.bucket.gets;
  expect(await readAuthorizedArchivedHistory(f.env,'simulation','sim',1,{...owner,id:'reader'})).toMatchObject({ok:false,reason:'forbidden'});
  expect(await readAuthorizedArchivedHistory(f.env,'simulation','other',1,owner)).toMatchObject({ok:false,reason:'missing'});
  expect(f.bucket.gets).toBe(gets,'denied and mismatched requests must not read R2');
  f.db.db.prepare("INSERT INTO simulation_roles(simulation_id,user_id,role,created_at) VALUES('sim','reader','editor','2026-09-17')").run();
  f.bucket.afterGet=()=>f.db.db.prepare("DELETE FROM simulation_roles WHERE simulation_id='sim' AND user_id='reader'").run();
  expect(await readAuthorizedArchivedHistory(f.env,'simulation','sim',1,{...owner,id:'reader'})).toMatchObject({ok:false,reason:'forbidden'});
  f.bucket.afterGet=()=>f.db.db.prepare("UPDATE resource_changes SET snapshot_json=json_set(snapshot_json,'$.ownerUserId','new-owner') WHERE id=1").run();
  await expect(readAuthorizedArchivedHistory(f.env,'simulation','sim',1,owner)).rejects.toThrow('History changed during hydration');
 }finally{f.db.db.close();}
});

it('fails application revert without changing a resource when R2 is corrupt or access is revoked during read',async()=>{
  const {revertResourceFromChangeCopy}=await import('./db');
  const f=setup();try{
    f.db.db.prepare("INSERT INTO simulations(id,owner_user_id,name,visibility,status,payload_json,updated_at) VALUES('sim','owner','Current','private','active',?,'2026-09-17')").run(JSON.stringify({id:'sim',name:'Current',ownerUserId:'owner'}));
    await archiveHistoryPage(f.env,{apply:true});
    const env={DB:f.env.DB,HISTORY_BUCKET:f.env.BUCKET,HISTORY_SCOPE:'synthetic-staging'} as Parameters<typeof revertResourceFromChangeCopy>[0];
    const owner={id:'owner',isAdmin:false,isModerator:false};
    f.bucket.corrupt=true;
    await expect(revertResourceFromChangeCopy(env,'simulation','sim',1,owner)).rejects.toThrow(/integrity|envelope/i);
    f.bucket.corrupt=false;
    f.db.db.prepare("INSERT INTO simulation_roles(simulation_id,user_id,role,created_at) VALUES('sim','reader','editor','2026-09-17')").run();
    f.bucket.afterGet=()=>f.db.db.prepare("DELETE FROM simulation_roles WHERE simulation_id='sim' AND user_id='reader'").run();
    expect(await revertResourceFromChangeCopy(env,'simulation','sim',1,{...owner,id:'reader'})).toMatchObject({ok:false,reason:'forbidden'});
    expect(JSON.parse(String(f.db.db.prepare("SELECT payload_json FROM simulations WHERE id='sim'").get()!.payload_json)).name).toBe('Current');
  }finally{f.db.db.close();}
});

it('rejects a half-written archive reference before application revert',async()=>{
  const {revertResourceFromChangeCopy}=await import('./db');
  const f=setup();try{
    f.db.db.prepare("INSERT INTO simulations(id,owner_user_id,name,visibility,status,payload_json,updated_at) VALUES('sim','owner','Current','private','active',?,'2026-09-17')").run(JSON.stringify({id:'sim',name:'Current',ownerUserId:'owner'}));
    await archiveHistoryPage(f.env,{apply:true});
    f.db.db.prepare('UPDATE resource_changes SET archive_key=NULL WHERE id=1').run();
    const env={DB:f.env.DB,HISTORY_BUCKET:f.env.BUCKET,HISTORY_SCOPE:'synthetic-staging'} as Parameters<typeof revertResourceFromChangeCopy>[0];
    await expect(revertResourceFromChangeCopy(env,'simulation','sim',1,{id:'owner',isAdmin:false,isModerator:false}))
      .rejects.toThrow(/incomplete archive reference/i);
    await expect(archiveHistoryPage(f.env,{apply:true})).rejects.toThrow(/incomplete archive reference/i);
    await expect(restoreHistoryRow(f.env,1)).rejects.toThrow(/incomplete archive reference/i);
    f.db.db.prepare("UPDATE resource_changes SET archive_key='' WHERE id=1").run();
    await expect(revertResourceFromChangeCopy(env,'simulation','sim',1,{id:'owner',isAdmin:false,isModerator:false}))
      .rejects.toThrow(/invalid archive reference/i);
    await expect(archiveHistoryPage(f.env,{apply:true})).rejects.toThrow(/invalid archive reference/i);
    await expect(restoreHistoryRow(f.env,1)).rejects.toThrow(/invalid archive reference/i);
    f.db.db.prepare("UPDATE resource_changes SET archive_digest='' WHERE id=1").run();
    await expect(revertResourceFromChangeCopy({DB:f.env.DB} as Parameters<typeof revertResourceFromChangeCopy>[0],
      'simulation','sim',1,{id:'owner',isAdmin:false,isModerator:false})).rejects.toThrow(/archive binding/i);
    expect(JSON.parse(String(f.db.db.prepare("SELECT payload_json FROM simulations WHERE id='sim'").get()!.payload_json)).name).toBe('Current');
  }finally{f.db.db.close();}
});

it('rejects an incomplete archive schema before unbound application revert',async()=>{
  const {revertResourceFromChangeCopy}=await import('./db');
  const db=new SqliteD1();try{
    db.db.exec(`ALTER TABLE resource_changes ADD COLUMN archive_digest TEXT;
INSERT INTO users(id,username) VALUES('owner','owner');
INSERT INTO simulations(id,owner_user_id,name,visibility,status,payload_json,updated_at)
  VALUES('sim','owner','Current','private','active','{"id":"sim","name":"Current"}','2026-09-17');
INSERT INTO resource_changes(id,resource_kind,resource_id,action,actor_user_id,changed_at,snapshot_json,archive_digest)
  VALUES(1,'simulation','sim','updated','owner','2026-09-17','{"id":"sim","name":"Old"}','');`);
    await expect(revertResourceFromChangeCopy({DB:db as unknown as D1Database} as Parameters<typeof revertResourceFromChangeCopy>[0],
      'simulation','sim',1,{id:'owner',isAdmin:false,isModerator:false})).rejects.toThrow(/incomplete history archive schema/i);
    expect(JSON.parse(String(db.db.prepare("SELECT payload_json FROM simulations WHERE id='sim'").get()!.payload_json)).name).toBe('Current');
  }finally{db.db.close();}
});

it('copies a validated production archive into a separately verified staging object without changing source D1', async () => {
  const f=setup();
  try {
    const production={...f.env,scope:'synthetic-production'};
    await archiveHistoryPage(production,{apply:true});
    const source=f.row();
    const staging=new Bucket();
    const copied=await copyArchivedHistoryRowForStaging(production,staging as unknown as R2Bucket,1);
    expect(copied).toMatchObject({id:1,sourceKey:source.archive_key,sourceDigest:source.archive_digest});
    expect(copied.stagingKey).toMatch(/^history-prototype\/synthetic-staging\/1\//);
    expect(copied.stagingKey).not.toBe(source.archive_key);
    expect(copied.stagingDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(f.row()).toEqual(source);
    const staged=JSON.parse(staging.objects.get(copied.stagingKey)!);
    expect(staged).toMatchObject({version:1,scope:'synthetic-staging',id:1,snapshot_json:f.snapshot,details_json:f.details});
    const stagingDb=new SqliteD1();
    try {
      stagingDb.db.exec('ALTER TABLE resource_changes ADD COLUMN archive_key TEXT; ALTER TABLE resource_changes ADD COLUMN archive_digest TEXT');
      stagingDb.db.prepare('INSERT INTO users(id,username) VALUES(?,?)').run('owner','owner');
      stagingDb.db.prepare("INSERT INTO resource_changes(id,resource_kind,resource_id,action,actor_user_id,changed_at,snapshot_json,details_json,archive_key,archive_digest) VALUES(1,'simulation','sim','updated','owner','2026-09-17',?,?,?,?)")
        .run(source.snapshot_json,source.details_json,copied.stagingKey,copied.stagingDigest);
      expect(await hydrateHistoryRow({DB:stagingDb as unknown as D1Database,BUCKET:staging as unknown as R2Bucket,scope:'synthetic-staging'},1))
        .toMatchObject({snapshot_json:f.snapshot,details_json:f.details});
    } finally { stagingDb.db.close(); }
  } finally { f.db.db.close(); }
});

it('supports a production-to-staging copy without reusing the source namespace', async () => {
  const f=setup();
  try {
    const production={...f.env,scope:'production'};
    await archiveHistoryPage(production,{apply:true});
    const source=f.row();
    const staging=new Bucket();
    const copied=await copyArchivedHistoryRowForStaging(production,staging as unknown as R2Bucket,1);
    expect(copied.stagingKey).toMatch(/^history-prototype\/staging\/1\//);
    expect(copied.stagingKey).not.toBe(source.archive_key);
    expect(f.row()).toEqual(source);
    const staged=JSON.parse(staging.objects.get(copied.stagingKey)!);
    expect(staged).toMatchObject({scope:'staging',id:1,snapshot_json:f.snapshot,details_json:f.details});
  } finally { f.db.db.close(); }
});

it('reuses a verified staging copy across refreshes without another R2 write', async () => {
  const f=setup();
  try {
    const production={...f.env,scope:'production'};
    await archiveHistoryPage(production,{apply:true});
    const staging=new Bucket();
    const first=await copyArchivedHistoryRowForStaging(production,staging as unknown as R2Bucket,1);
    const second=await copyArchivedHistoryRowForStaging(production,staging as unknown as R2Bucket,1);
    expect(second).toEqual(first);
    expect(staging.puts).toBe(1);
    expect(staging.heads).toBe(2);
    expect(staging.gets).toBe(2);
    staging.corrupt=true;
    await expect(copyArchivedHistoryRowForStaging(production,staging as unknown as R2Bucket,1)).rejects.toThrow(/integrity/i);
    expect(staging.puts).toBe(1);
  } finally { f.db.db.close(); }
});

it('refuses inline, corrupt, foreign or unverified archive copies and leaves source unchanged', async () => {
  const f=setup();
  try {
    const production={...f.env,scope:'synthetic-production'};
    const staging=new Bucket();
    await expect(copyArchivedHistoryRowForStaging(production,staging as unknown as R2Bucket,1)).rejects.toThrow();
    await archiveHistoryPage(production,{apply:true});
    const source=f.row();
    f.bucket.corrupt=true;
    await expect(copyArchivedHistoryRowForStaging(production,staging as unknown as R2Bucket,1)).rejects.toThrow();
    f.bucket.corrupt=false;
    staging.failPut=true;
    await expect(copyArchivedHistoryRowForStaging(production,staging as unknown as R2Bucket,1)).rejects.toThrow();
    staging.failPut=false;staging.corrupt=true;
    await expect(copyArchivedHistoryRowForStaging(production,staging as unknown as R2Bucket,1)).rejects.toThrow();
    staging.corrupt=false;
    await expect(copyArchivedHistoryRowForStaging({...production,scope:'synthetic-staging'},staging as unknown as R2Bucket,1)).rejects.toThrow();
    await expect(copyArchivedHistoryRowForStaging({...production,scope:'production'},staging as unknown as R2Bucket,1)).rejects.toThrow(/Invalid archive reference/);
    expect(f.row()).toEqual(source);
  } finally { f.db.db.close(); }
});

it('keeps synthetic source history intact even if distinct bucket bindings alias one backing store', async () => {
  const f=setup();
  try {
    const production={...f.env,scope:'synthetic-production'};
    await archiveHistoryPage(production,{apply:true});
    const source=f.row();
    const original=f.bucket.objects.get(String(source.archive_key));
    const aliased=new Bucket();
    aliased.objects=f.bucket.objects;
    const copied=await copyArchivedHistoryRowForStaging(production,aliased as unknown as R2Bucket,1);
    expect(copied.stagingKey).toMatch(/^history-prototype\/synthetic-staging\/1\//);
    expect(f.bucket.objects.get(String(source.archive_key))).toBe(original);
    expect(f.row()).toEqual(source);
    await expect(copyArchivedHistoryRowForStaging({...production,scope:'production'},aliased as unknown as R2Bucket,1))
      .rejects.toThrow(/Invalid archive reference/);
  } finally { f.db.db.close(); }
});
