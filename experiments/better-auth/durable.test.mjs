import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from './durable-gateway.mjs';
import { durableConfigs } from './durable-config.mjs';
const origin = 'https://linksim-auth-probe-test.example.workers.dev';
const vars = { PROBE_ENABLED: 'github-passkey-validation', PROBE_ORIGIN: origin,
  PROBE_GITHUB_ID: '88513', PROBE_EXPIRES_AT: new Date(Date.now()+3600000).toISOString() };
const base = () => ({ name:'linksim-auth-probe-test', main:'live-worker.mjs', compatibility_date:'2026-03-12',
  compatibility_flags:['nodejs_compat'], workers_dev:true, vars, d1_databases:[{
    binding:'DB',database_name:'linksim-auth-probe-test',database_id:'11111111-1111-4111-8111-111111111111'}] });

test('paired deployment preserves isolated D1 and makes only the gateway public', () => {
  const { gateway, runtime } = durableConfigs(base());
  assert.equal(runtime.workers_dev, false);
  assert.equal(gateway.d1_databases, undefined);
  assert.equal(gateway.vars.GITHUB_CLIENT_SECRET, undefined);
  assert.equal(runtime.d1_databases[0].database_name, base().name);
  assert.equal(gateway.durable_objects.bindings[0].script_name, runtime.name);
  assert.deepEqual(runtime.migrations, [{tag:'v1',new_sqlite_classes:['AuthProbe']}]);
  assert.throws(() => durableConfigs({...base(),routes:['example.com/*']}));
});

test('gateway rejects internal routes, unsafe origins and expired configuration before binding access', async () => {
  const gateway = createGateway({page:'page',script:'script'});
  const env = {...vars,AUTH:{getByName(){throw Error('binding must not be reached');}}};
  for(const path of ['/internal/session','/probe/fixture','/api/auth/unknown'])
    assert.equal((await gateway.fetch(new Request(origin+path),env)).status,404);
  assert.equal((await gateway.fetch(new Request(origin+'/api/auth/sign-out',{method:'POST',headers:{origin:'https://evil.example'}}),env)).status,403);
  assert.equal((await gateway.fetch(new Request(origin),{...env,PROBE_EXPIRES_AT:'invalid'})).status,404);
});

test('50 simultaneous requests use one object and isolated allowlisted headers', async () => {
  const names=[]; const seen=[];
  const stub={async checkSession(request, fresh){await new Promise(resolve=>setImmediate(resolve));seen.push(request);return Response.json({cookie:request.headers.get('cookie'),fresh});}};
  const env={...vars,AUTH:{getByName(name){names.push(name);return stub;}}};
  const gateway=createGateway({page:'page',script:'script'});
  const responses=await Promise.all(Array.from({length:50},(_,i)=>gateway.fetch(new Request(origin+'/probe/session/reused',{
    headers:{cookie:`session=${i}`,'x-forwarded-for':'evil','x-auth-user':'admin','cf-connecting-ip':'192.0.2.1'},
  }),env)));
  for(let i=0;i<50;i++) assert.deepEqual(await responses[i].json(),{cookie:`session=${i}`,fresh:false});
  assert.deepEqual(new Set(names),new Set(['auth']));
  assert.ok(seen.every(r=>!r.headers.has('x-forwarded-for')&&!r.headers.has('x-auth-user')));
});

test('binding resource failures return a generic unavailable response without retrying', async () => {
  for (const path of ['/probe/session/reused','/api/auth/get-session']) {
    let calls=0;
    const fail=async()=>{calls++;throw new Error('Worker exceeded resource limits: private detail');};
    const env={...vars,AUTH:{getByName(){return {checkSession:fail,fetch:fail};}}};
    const response=await createGateway({page:'page',script:'script'}).fetch(new Request(origin+path),env);
    assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{error:'Validation runtime unavailable'});
    assert.equal(response.headers.has('set-cookie'),false);
    assert.equal(calls,1);
  }
});

test('gateway marks exactly its first invocation before concurrent I/O',async()=>{
  const records=[];
  const gateway=createGateway({page:'page',script:'script',record:entry=>records.push(entry)});
  const env={...vars,AUTH:{getByName(){return {fetch:async()=>Response.json(null)};}}};
  await Promise.all(Array.from({length:50},()=>gateway.fetch(new Request(origin+'/api/auth/get-session?private=secret'),env)));
  assert.deepEqual(records,[{event:'probe-gateway-first-invocation',path:'/api/auth/get-session'}]);
  const second=[];
  await createGateway({page:'page',script:'script',record:entry=>second.push(entry)}).fetch(new Request(origin+'/unknown/private'),env);
  assert.deepEqual(second,[{event:'probe-gateway-first-invocation',path:'[other]'}]);
});
