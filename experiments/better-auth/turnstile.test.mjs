import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveOptions } from './live.mjs';
import { getTurnstileToken } from './turnstile-client.mjs';

const origin='https://linksim-auth-probe-test.example.workers.dev';
const env={PROBE_ORIGIN:origin,PROBE_TURNSTILE_MODE:'real',TURNSTILE_SITE_KEY:'0xLOCALPUBLICKEYFORTESTONLY',
  TURNSTILE_SECRET_KEY:'0xLOCALSECRETKEYFORTESTONLY'};

test('real Turnstile fails closed and uses library hostname/action verification', async () => {
  assert.throws(()=>liveOptions({...env,TURNSTILE_SECRET_KEY:undefined}));
  const options=liveOptions(env);
  const plugin=options.plugins.find(p=>p.id==='captcha');
  assert.deepEqual(plugin.options.allowedHostnames,[new URL(origin).hostname]);
  assert.equal(plugin.options.expectedAction,'github-login');
  const original=globalThis.fetch;
  const ctx={options,logger:{error(){}}};
  let calls=0;
  let reply={success:true,hostname:new URL(origin).hostname,action:'github-login'};
  globalThis.fetch=async()=>{calls++;return Response.json(reply);};
  const request=(token)=>new Request(origin+'/api/auth/sign-in/social',{method:'POST',headers:token?{'x-captcha-response':token}:{}});
  try {
    assert.ok(await plugin.onRequest(request(),ctx));
    assert.equal(calls,0,'missing token never reaches siteverify');
    assert.equal(await plugin.onRequest(request('valid-local-token'),ctx),undefined);
    for(const invalid of [{success:false,'error-codes':['timeout-or-duplicate']},
      {...reply,hostname:'other.example'}, {...reply,action:'other'}, {success:true}]) {
      reply=invalid;
      assert.ok(await plugin.onRequest(request('invalid-local-token'),ctx));
    }
    globalThis.fetch=async()=>{throw new Error('local simulated outage');};
    assert.ok(await plugin.onRequest(request('local-outage-token'),ctx));
  } finally {globalThis.fetch=original;}
});

test('browser requests a new token per attempt and removes widgets on errors/timeouts', async () => {
  const container={dataset:{sitekey:env.TURNSTILE_SITE_KEY},replaceChildren(){}};
  let renders=0;
  const removed=[];
  let behavior='success';
  const api={render(_container,options){
    const id=++renders;
    assert.equal(options.action,'github-login');
    queueMicrotask(()=>{
      if(behavior==='success') options.callback(`token-${id}`);
      if(behavior==='error') options['error-callback']();
      if(behavior==='expired') options['expired-callback']();
    });
    return id;
  },remove(id){removed.push(id);}};
  const options={load:async()=>api,timeoutMs:10};
  assert.equal(await getTurnstileToken(container,options),'token-1');
  assert.equal(await getTurnstileToken(container,options),'token-2');
  for(const failure of ['error','expired','timeout']) {
    behavior=failure;
    await assert.rejects(getTurnstileToken(container,options));
  }
  assert.deepEqual(removed,[1,2,3,4,5]);
  await assert.rejects(getTurnstileToken(container,{load:async()=>{throw new Error('offline');}}),/offline/);
});
