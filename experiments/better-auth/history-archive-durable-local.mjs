// Synthetic workerd proof of the gateway -> private Durable Object -> D1/R2 chain.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { indexedArchiveSchema } from './history-archive-indexed-schema.mjs';

const indexed=process.argv[2]==='--indexed';
const mixed=process.argv[3]==='--mixed';
assert.ok(process.argv.length===2||indexed&&process.argv.length===3||indexed&&mixed&&process.argv.length===4,
  'Usage: history-archive-durable-local.mjs [--indexed [--mixed]]');
const root=fileURLToPath(new URL('../../',import.meta.url));
const scratch=fileURLToPath(new URL('./.wrangler/history-archive-durable-local/',import.meta.url));
mkdirSync(scratch,{recursive:true});
const bundle=async(entry,output,platform='browser')=>{
 const built=await build({absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,format:'esm',platform,external:platform==='browser'?['cloudflare:workers']:[]});
 writeFileSync(scratch+output,built.outputFiles[0].text);
 return built.outputFiles[0].text;
};
const fixture=await bundle('experiments/better-auth/history-archive-fixtures.ts','fixture.js','node');
const {archiveFixtureRows,archiveFixtureSchema,archiveMixedFixtureRows}=await import('data:text/javascript;base64,'+Buffer.from(fixture).toString('base64'));
await bundle('experiments/better-auth/history-archive-gateway.ts','gateway.js');
await bundle('experiments/better-auth/history-archive-runtime.ts','runtime.js');
const expiry=new Date(Date.now()+3600000).toISOString();
const common={modules:true,compatibilityDate:'2026-03-12',bindings:{PROBE_KEY:'local-synthetic',PROBE_ENABLED:'synthetic-history-r2',PROBE_EXPIRES_AT:expiry}};
const mf=new Miniflare(convertV4MiniflareOptions({workers:[
 {...common,name:'gateway',scriptPath:scratch+'gateway.js',durableObjects:{ARCHIVE:{className:'HistoryArchiveProbe',scriptName:'runtime',useSQLite:true}}},
 {...common,name:'runtime',scriptPath:scratch+'runtime.js',d1Databases:['DB'],r2Buckets:['BUCKET'],durableObjects:{ARCHIVE:{className:'HistoryArchiveProbe',useSQLite:true}},outboundService:()=>new Response(null,{status:403})},
]}));
try {
 const DB=await mf.getD1Database('DB','runtime');
 if(indexed)for(const sql of indexedArchiveSchema().split(';').filter(sql=>sql.trim()))await DB.prepare(sql).run();
 const call=(path,key='local-synthetic')=>mf.dispatchFetch('https://synthetic.example'+path,{method:'POST',headers:{authorization:'Bearer '+key}});
 assert.equal((await call('/archive?id=1','wrong')).status,404);
 assert.equal((await call('/other')).status,404);
 const results=[];
 if(mixed){
  const rows=archiveMixedFixtureRows();
  const insert=DB.prepare('INSERT INTO resource_changes(id,resource_kind,resource_id,action,actor_user_id,changed_at,note,snapshot_json,details_json) VALUES(?,?,?, ?,?,?, ?,?,?)');
  for(const row of rows)await insert.bind(row.id,row.resource_kind,row.resource_id,'updated','synthetic-owner','2026-09-18',row.note,row.snapshot_json,row.details_json).run();
  let converted=0;
  for(let id=1;id<=100;id+=10){
   const start=Date.now(),response=await call(`/archive?id=${id}`);
   assert.equal(response.status,200,`mixed archive page ${id}`);
   const body=await response.json();
   assert.equal(body.result.converted,id===91?9:10,`mixed archive page ${id} converted rows`);
   converted+=body.result.converted;
   results.push({scenario:'mixed',path:`/archive?id=${id}`,elapsedMs:Date.now()-start,objectElapsedMs:Number(response.headers.get('x-probe-object-elapsed-ms')),metrics:body.metrics,result:body.result});
  }
  assert.equal(converted,99);
  assert.equal((await DB.prepare('SELECT archive_key FROM resource_changes WHERE id=100').first()).archive_key,null,
    'ordinary deleted Site should remain in D1');
  for(const id of [1,3,38,39]){
   const projection=await DB.prepare('SELECT snapshot_json,details_json,archive_key FROM resource_changes WHERE id=?').bind(id).first();
   assert.ok(projection.archive_key,`mixed archived row ${id}`);
   assert.equal(JSON.parse(projection.snapshot_json).visibility,JSON.parse(rows[id-1].snapshot_json).visibility);
   assert.equal(JSON.parse(projection.snapshot_json).ownerUserId,'synthetic-owner');
  }
  for(const id of [1,3,38,39,100]){
   const response=await call(`/hydrate?id=${id}`);
   assert.equal(response.status,200,`mixed hydrate ${id}`);
   const body=await response.json();
   assert.equal(body.result.found,true);
   results.push({scenario:'mixed',path:`/hydrate?id=${id}`,objectElapsedMs:Number(response.headers.get('x-probe-object-elapsed-ms')),metrics:body.metrics,result:body.result});
  }
  for(const id of [1,3,38,39]){
   const response=await call(`/restore?id=${id}`);
   assert.equal(response.status,200,`mixed restore ${id}`);
   const body=await response.json();
   assert.equal(body.result.restored,true);
   results.push({scenario:'mixed',path:`/restore?id=${id}`,objectElapsedMs:Number(response.headers.get('x-probe-object-elapsed-ms')),metrics:body.metrics,result:body.result});
  }
  for(const id of [1,3,38,39,100]){
   const row=await DB.prepare('SELECT snapshot_json,details_json FROM resource_changes WHERE id=?').bind(id).first();
   assert.deepEqual(row,{snapshot_json:rows[id-1].snapshot_json,details_json:rows[id-1].details_json});
  }
 }else for(const scenario of ['small','large','max-record','max-batch'])for(const entropy of ['repetitive','varied']){
  if(indexed)await DB.prepare('DELETE FROM resource_changes').run();
  else{await DB.prepare('DROP TABLE IF EXISTS resource_changes').run();await DB.prepare(archiveFixtureSchema).run();}
  for(const row of archiveFixtureRows(scenario,entropy)){
   const sql=indexed
    ? 'INSERT INTO resource_changes(id,resource_kind,resource_id,action,actor_user_id,changed_at,snapshot_json,details_json) VALUES(?,?,?,?,?,?,?,?)'
    : 'INSERT INTO resource_changes(id,snapshot_json,details_json) VALUES(?,?,?)';
   const values=indexed
    ? [row.id,'simulation',`synthetic-${row.id}`,'updated','synthetic-owner','2026-09-18',row.snapshot_json,row.details_json]
    : [row.id,row.snapshot_json,row.details_json];
   await DB.prepare(sql).bind(...values).run();
  }
  const original=await DB.prepare('SELECT snapshot_json,details_json FROM resource_changes WHERE id=1').first();
  for(const path of scenario==='max-batch'?['/archive?id=1','/archive?id=11','/hydrate?id=1','/restore?id=1']:['/archive?id=1','/hydrate?id=1','/restore?id=1']){
   const start=Date.now(),response=await call(path);
   assert.equal(response.status,200,`${scenario}/${entropy}${path}`);
   const body=await response.json();
   if(path.startsWith('/archive'))assert.equal(body.result.converted,scenario==='max-batch'?10:1,`${scenario}/${entropy}${path} converted rows`);
   if(path.startsWith('/hydrate'))assert.equal(body.result.found,true,`${scenario}/${entropy} hydrated row`);
   if(path.startsWith('/restore'))assert.equal(body.result.restored,true,`${scenario}/${entropy} restored row`);
   results.push({scenario,entropy,path,elapsedMs:Date.now()-start,objectElapsedMs:Number(response.headers.get('x-probe-object-elapsed-ms')),metrics:body.metrics,result:body.result});
  }
  assert.deepEqual(await DB.prepare('SELECT snapshot_json,details_json FROM resource_changes WHERE id=1').first(),original);
 }
 console.log(JSON.stringify({source:'synthetic local gateway + Durable Object + D1 + R2; elapsed time is not CPU',schema:indexed?'application history table and indexes':'minimal fixture',fixture:mixed?'mixed-audience with one deleted Site':'private Simulation',requests:results.length,results},null,2));
} finally { await mf.dispose(); }
