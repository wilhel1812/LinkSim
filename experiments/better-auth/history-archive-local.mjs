// Local workerd/D1/R2 only. Synthetic fixtures, no outbound network.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bundle=async(entry,platform)=> (await build({absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,format:'esm',platform})).outputFiles[0].text;
const {archiveFixtureRows,archiveFixtureSchema}=await import('data:text/javascript;base64,'+Buffer.from(await bundle('experiments/better-auth/history-archive-fixtures.ts','node')).toString('base64'));
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-03-12',script:await bundle('experiments/better-auth/history-archive-worker.ts','browser'),
  d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{PROBE_KEY:'local-synthetic',PROBE_ENABLED:'synthetic-history-r2',PROBE_EXPIRES_AT:new Date(Date.now()+3600000).toISOString()},outboundService:()=>new Response(null,{status:403})}));
try{
 const DB=await mf.getD1Database('DB');const results=[];
 assert.equal((await mf.dispatchFetch('http://localhost/archive',{method:'POST'})).status,404);
 for(const scenario of ['small','large','max-record','max-batch'])for(const entropy of ['repetitive','varied']){
  await DB.prepare('DROP TABLE IF EXISTS resource_changes').run();await DB.prepare(archiveFixtureSchema).run();
  for(const row of archiveFixtureRows(scenario,entropy))await DB.prepare('INSERT INTO resource_changes(id,snapshot_json,details_json) VALUES(?,?,?)').bind(row.id,row.snapshot_json,row.details_json).run();
  const before=await DB.prepare('SELECT id,snapshot_json,details_json FROM resource_changes ORDER BY id').all();
  for(const path of scenario==='max-batch'?['/archive?id=1','/archive?id=11','/hydrate?id=1','/restore?id=1']:['/archive?id=1','/hydrate?id=1','/restore?id=1']){
   const start=Date.now(),response=await mf.dispatchFetch('http://localhost'+path,{method:'POST',headers:{authorization:'Bearer local-synthetic'}});
   assert.equal(response.status,200);results.push({scenario,entropy,path,elapsedMs:Date.now()-start,...await response.json()});
  }
  const restored=await DB.prepare('SELECT id,snapshot_json,details_json FROM resource_changes WHERE id=1').first();assert.deepEqual(restored,before.results[0]);
 }
 console.log(JSON.stringify({source:'local synthetic workerd + D1 + R2; elapsed milliseconds are not billed CPU; counts exclude fixture creation',results},null,2));
}finally{await mf.dispose();}
