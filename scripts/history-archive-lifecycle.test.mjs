import assert from 'node:assert/strict';
import { test } from 'vitest';
import { finishArchiveRun, resumeArchiveSetup, teardownArchiveProbe, bucketInfoResult } from '../experiments/better-auth/history-archive-lifecycle.mjs';

test('persists all results before failing HTTP, transport or incomplete runs',()=>{
 for(const results of [[{status:503}],[{outcome:'transport-failure'}],[]]){
  let saved;
  assert.throws(()=>finishArchiveRun(results,1,value=>{saved=value;}));assert.equal(saved,results);
 }
 let saved;finishArchiveRun([{status:200}],1,value=>{saved=value;});assert.equal(saved.length,1);
});
test('resumes bucket creation without recreating a persisted database',async()=>{
 let id,bucket=false,fail=true,creates=0;
 const dependencies={databaseId:()=>id,createDatabase:async()=>{creates++;return 'synthetic-id';},saveDatabaseId:value=>{id=value;},verifyDatabase:async value=>assert.equal(value,'synthetic-id'),bucketExists:async()=>bucket,createBucket:async()=>{if(fail)throw Error('interrupted');bucket=true;}};
 await assert.rejects(resumeArchiveSetup(dependencies),/interrupted/);assert.equal(id,'synthetic-id');
 fail=false;await resumeArchiveSetup(dependencies);await resumeArchiveSetup(dependencies);assert.equal(creates,1);assert.equal(bucket,true);
});
test('teardown renews/deploys cleanup before using an expired or absent Worker',async()=>{
 const calls=[];
 await teardownArchiveProbe({prepareCleanup:async()=>calls.push('renew-and-deploy'),cleanup:async()=>calls.push('empty'),deleteBucket:async()=>calls.push('bucket'),deleteWorker:async()=>calls.push('worker'),deleteDatabase:async()=>calls.push('database'),removeKey:()=>calls.push('key')});
 assert.deepEqual(calls,['renew-and-deploy','empty','bucket','worker','database','key']);
});
test('cleanup failure retains bindings and key for a retry',async()=>{
 const calls=[];
 await assert.rejects(teardownArchiveProbe({prepareCleanup:async()=>{},cleanup:async()=>{throw Error('storage unavailable');},deleteBucket:async()=>calls.push('bucket'),deleteWorker:async()=>calls.push('worker'),deleteDatabase:async()=>calls.push('database'),removeKey:()=>calls.push('key')}));
 assert.deepEqual(calls,[]);
});
test('only the verified not-found code means an absent bucket',()=>{
 assert.equal(bucketInfoResult({status:1,stderr:'The specified bucket does not exist. [code: 10006]'}),false);
 assert.throws(()=>bucketInfoResult({status:1,stderr:'Unauthorized [code: 10000]'}));
 assert.throws(()=>bucketInfoResult({status:null,stderr:'network failure'}));
 assert.equal(bucketInfoResult({status:0,stdout:'{}'}),true);
});
