// Guarded disposable infrastructure. No application resource is accepted.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,unlinkSync,statSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=fileURLToPath(new URL('../../',import.meta.url)),directory=fileURLToPath(new URL('.',import.meta.url));
const scratch=directory+'.wrangler/history-archive',configPath=scratch+'/wrangler.json',keyPath=scratch+'/key';
const name='linksim-history-r2-probe-1107',origin=`https://${name}.wilhelm-francke.workers.dev`;
const action=process.argv[2];assert.ok(['prepare','create','deploy','run','delete'].includes(action)&&process.argv.length===3);
const expected=(expires,id)=>({name,account_id:'85c57e0c4da3a747a09212dc5b090f52',main:directory+'history-archive-worker.ts',compatibility_date:'2026-03-12',workers_dev:true,preview_urls:false,
 observability:{enabled:true,head_sampling_rate:1},vars:{PROBE_ENABLED:'synthetic-history-r2',PROBE_EXPIRES_AT:expires},
 ...(id?{d1_databases:[{binding:'DB',database_name:name,database_id:id}],r2_buckets:[{binding:'BUCKET',bucket_name:name}]}:{})});
const invoke=(args,input,capture=false)=>{
 const result=spawnSync(process.execPath,[root+'node_modules/wrangler/bin/wrangler.js',...args,'--config',configPath,'--env',''],{cwd:root,encoding:'utf8',input,stdio:capture?'pipe':['pipe','inherit','inherit'],maxBuffer:10*1024*1024});
 assert.equal(result.status,0,`Wrangler ${args[0]} failed${capture?': '+result.stderr:''}`);return result.stdout;
};
if(action==='prepare'){
 mkdirSync(scratch,{recursive:true});assert.ok(!existsSync(configPath),'Do not replace an existing resource manifest');
 writeFileSync(keyPath,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
 writeFileSync(configPath,JSON.stringify(expected(new Date(Date.now()+4*3600000).toISOString()),null,2),{mode:0o600,flag:'wx'});
}else{
 const config=JSON.parse(readFileSync(configPath,'utf8')),id=config.d1_databases?.[0]?.database_id;
 assert.deepEqual(config,expected(config.vars?.PROBE_EXPIRES_AT,id),'Resource/config drift');
 assert.equal(statSync(keyPath).mode&0o077,0);const key=readFileSync(keyPath,'utf8').trim();assert.match(key,/^[a-f0-9]{64}$/);
 const call=(path)=>fetch(origin+path,{method:'POST',headers:{authorization:'Bearer '+key},redirect:'manual',signal:AbortSignal.timeout(30000)});
 if(action==='create'){
  assert.ok(!id,'Already created');
  const output=invoke(['d1','create',name],undefined,true),match=output.match(/"database_id"\s*:\s*"([a-f0-9-]{36})"/);assert.ok(match,'Missing new D1 identifier');
  // Persist the created D1 ID before the next mutation so partial setup is recoverable.
  writeFileSync(configPath,JSON.stringify(expected(config.vars.PROBE_EXPIRES_AT,match[1]),null,2),{mode:0o600});
  invoke(['r2','bucket','create',name]);
 }else{
  assert.match(id??'',/^[a-f0-9-]{36}$/);
  const info=JSON.parse(invoke(['d1','info',name,'--json'],undefined,true));
  assert.equal(info.name,name,'Disposable D1 name mismatch');assert.equal(info.uuid,id,'Disposable D1 identifier mismatch');
  if(action!=='delete')assert.ok(Date.parse(config.vars.PROBE_EXPIRES_AT)>Date.now(),'Probe expired');
  if(action==='deploy'){invoke(['deploy']);invoke(['secret','put','PROBE_KEY'],key);}
  if(action==='run'){
   assert.equal((await fetch(origin+'/archive',{method:'POST',redirect:'manual'})).status,404);
   const bundle=await build({absWorkingDir:root,entryPoints:[directory+'history-archive-fixtures.ts'],bundle:true,write:false,format:'esm',platform:'node'});
   const {archiveFixtureRows,archiveFixtureSchema}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
   const results=[];const quote=s=>"'"+s.replaceAll("'","''")+"'";
   try{for(const scenario of ['max-batch','max-record','large','small'])for(const entropy of ['varied','repetitive']){
    const sql=['DROP TABLE IF EXISTS resource_changes;',archiveFixtureSchema+';'];
    for(const row of archiveFixtureRows(scenario,entropy)){
     sql.push(`INSERT INTO resource_changes(id,snapshot_json,details_json) VALUES(${row.id},'','');`);
     for(const field of ['snapshot_json','details_json'])for(let offset=0;offset<row[field].length;offset+=16000)sql.push(`UPDATE resource_changes SET ${field}=${field}||${quote(row[field].slice(offset,offset+16000))} WHERE id=${row.id};`);
    }
    writeFileSync(scratch+'/fixture.sql',sql.join('\n'));
    invoke(['d1','execute',name,'--remote','--file',scratch+'/fixture.sql','--yes'],undefined,true);
    for(const path of scenario==='max-batch'?['/archive?id=1','/archive?id=11','/hydrate?id=1','/restore?id=1']:['/archive?id=1','/hydrate?id=1','/restore?id=1']){
     const startedAt=Date.now();let result;
     try{const response=await call(path);result={scenario,entropy,path,startedAt,status:response.status,elapsedMs:Date.now()-startedAt,aggregate:response.ok?await response.json():null};}
     catch{result={scenario,entropy,path,startedAt,elapsedMs:Date.now()-startedAt,outcome:'transport-failure'};}
     results.push(result);console.log(JSON.stringify(result));
    }
   }}finally{writeFileSync(scratch+'/results.json',JSON.stringify({source:'Synthetic remote archive component; CPU recorded separately; fixture setup excluded',results},null,2));}
  }
  if(action==='delete'){
   assert.equal((await call('/cleanup')).status,200,'Empty private synthetic bucket before teardown');
   invoke(['delete','--force']);invoke(['r2','bucket','delete',name]);invoke(['d1','delete',name,'--skip-confirmation']);unlinkSync(keyPath);
  }
 }
}
