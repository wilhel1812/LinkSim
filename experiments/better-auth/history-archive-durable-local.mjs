// Synthetic workerd proof of the gateway -> private Durable Object -> D1/R2 chain.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { indexedArchiveSchema } from './history-archive-indexed-schema.mjs';

const indexed=process.argv.length===3&&process.argv[2]==='--indexed';
assert.ok(process.argv.length===2||indexed,'Usage: history-archive-durable-local.mjs [--indexed]');
const root=fileURLToPath(new URL('../../',import.meta.url));
const scratch=fileURLToPath(new URL('./.wrangler/history-archive-durable-local/',import.meta.url));
mkdirSync(scratch,{recursive:true});
const bundle=async(entry,output,platform='browser')=>{
 const built=await build({absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,format:'esm',platform,external:platform==='browser'?['cloudflare:workers']:[]});
 writeFileSync(scratch+output,built.outputFiles[0].text);
 return built.outputFiles[0].text;
};
const fixture=await bundle('experiments/better-auth/history-archive-fixtures.ts','fixture.js','node');
const {archiveFixtureRows,archiveFixtureSchema}=await import('data:text/javascript;base64,'+Buffer.from(fixture).toString('base64'));
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
 for(const scenario of ['small','large','max-record','max-batch'])for(const entropy of ['repetitive','varied']){
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
 console.log(JSON.stringify({source:'synthetic local gateway + Durable Object + D1 + R2; elapsed time is not CPU',schema:indexed?'application history table and indexes':'minimal fixture',requests:results.length,results},null,2));
} finally { await mf.dispose(); }
