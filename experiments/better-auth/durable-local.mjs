// Local workerd/D1 integration only. Synthetic identities never enter the live probe.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { testUtils } from 'better-auth/plugins';
import { liveOptions } from './live.mjs';
import { turnstileAction } from './turnstile-policy.mjs';
const origin='https://linksim-auth-probe-local.example.workers.dev';
const vars={PROBE_ENABLED:'github-passkey-validation',PROBE_ORIGIN:origin,PROBE_GITHUB_ID:'88513',
  PROBE_EXPIRES_AT:new Date(Date.now()+3600000).toISOString(),GITHUB_CLIENT_ID:'local-only',
  GITHUB_CLIENT_SECRET:'local-only',BETTER_AUTH_SECRET:'local-only-secret-at-least-32-characters',
  PROBE_TURNSTILE_MODE:'real',TURNSTILE_SITE_KEY:'0xLOCALPUBLICKEYFORTESTONLY',TURNSTILE_SECRET_KEY:'0xLOCALSECRETKEYFORTESTONLY'};
const common={modules:true,compatibilityDate:'2026-03-12',compatibilityFlags:['nodejs_compat'],bindings:vars};
const mf=new Miniflare(convertV4MiniflareOptions({workers:[
  {...common,name:'gateway',scriptPath:'.wrangler/durable-gateway/durable-gateway-worker.js',
    durableObjects:{AUTH:{className:'AuthProbe',scriptName:'runtime',useSQLite:true}}},
  {...common,name:'runtime',scriptPath:'.wrangler/durable-runtime/durable-runtime.js',d1Databases:['DB'],
    durableObjects:{AUTH:{className:'AuthProbe',useSQLite:true}},
    outboundService:request=> {
      const url=new URL(request.url);
      if(url.hostname==='challenges.cloudflare.com') return Response.json({success:true,hostname:new URL(origin).hostname,action:turnstileAction});
      if(url.hostname==='github.com' && url.pathname==='/login/oauth/access_token')
        return Response.json({access_token:'local-only-token',token_type:'bearer',scope:'read:user,user:email'});
      if(url.hostname==='api.github.com' && url.pathname==='/user')
        return Response.json({id:88513,login:'local-tester',name:'Local tester',email:'local-999@example.invalid'});
      if(url.hostname==='api.github.com' && url.pathname==='/user/emails')
        return Response.json([{email:'local-999@example.invalid',primary:true,verified:true}]);
      return new Response(null,{status:403});
    }},
]}));
const local=new DatabaseSync(':memory:');
try {
  const options=liveOptions({...vars,DB:local});
  await (await getMigrations(options)).runMigrations();
  const auth=betterAuth({...options,plugins:[...options.plugins,testUtils()]});
  const {test,internalAdapter}=await auth.$context;
  const credentials=[];
  for(let i=0;i<1000;i++) {
    const user=await test.saveUser(test.createUser({email:`local-${i}@example.invalid`,emailVerified:i%2===0}));
    await internalAdapter.createAccount({userId:user.id,providerId:'github',accountId:i===999?'88513':String(1000000+i)});
    if(i<50) credentials.push({user,headers:(await test.login({userId:user.id})).headers});
  }
  const db=await mf.getD1Database('DB','runtime');
  for(const sql of readFileSync('schema.sql','utf8').split(';').filter(s=>s.trim())) await db.prepare(sql).run();
  for(const sql of readFileSync('indexes.sql','utf8').split(';').filter(s=>s.trim())) await db.prepare(sql).run();
  for(const table of ['probe_user','probe_account','probe_session']) {
    const rows=local.prepare(`SELECT * FROM ${table}`).all();
    for(let i=0;i<rows.length;i+=50) await db.batch(rows.slice(i,i+50).map(row=> {
      const keys=Object.keys(row);
      return db.prepare(`INSERT INTO ${table} (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).bind(...Object.values(row));
    }));
  }
  const check=async(i,path='/probe/session/reused')=> {
    const response=await mf.dispatchFetch(origin+path,{headers:credentials[i].headers});
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.emailVerified,i%2===0);
    return JSON.parse(response.headers.get('x-probe-d1'));
  };
  const cold=await check(0);
  const burst=await Promise.all(credentials.map((_,i)=>check(i)));
  assert.ok(burst.every(m=>m.queries===1&&m.rowsWritten===0&&!m.initialized));
  // Age only synthetic local sessions to exercise the library's daily renewal.
  const oldExpiry = Date.now() + 5 * 86400000;
  await db.prepare('UPDATE probe_session SET expiresAt = ? WHERE userId = ?').bind(oldExpiry,credentials[1].user.id).run();
  const renewed = await mf.dispatchFetch(origin+'/probe/session/reused',{headers:credentials[1].headers});
  assert.equal(renewed.status,200);
  assert.ok(renewed.headers.get('set-cookie'),'library renewal cookie survives the private binding and gateway');
  await renewed.arrayBuffer();
  const refresh = JSON.parse(renewed.headers.get('x-probe-d1'));
  assert.ok(refresh.rowsWritten > 0,'due renewal must persist');
  const after = await db.prepare('SELECT expiresAt FROM probe_session WHERE userId = ?').bind(credentials[1].user.id).first();
  assert.ok(new Date(after.expiresAt).getTime() > oldExpiry);
  assert.equal((await check(1)).rowsWritten,0,'the next check does not renew again');
  // Real local object eviction, not just recreating Better Auth inside a warm object.
  await mf.unsafeEvictDurableObject('runtime','AuthProbe',{name:'auth'});
  const afterEviction = await Promise.all(credentials.map((_,i)=>check(i)));
  assert.equal(afterEviction.filter(m=>m.initialized).length,1,'cold burst shares one completed schema initialization');
  await db.prepare('UPDATE probe_session SET expiresAt = ? WHERE userId = ?').bind(Date.now()-1000,credentials[2].user.id).run();
  assert.equal((await mf.dispatchFetch(origin+'/probe/session/reused',{headers:credentials[2].headers})).status,401);
  const initiations=await Promise.all(Array.from({length:20},(_,i)=>mf.dispatchFetch(origin+'/api/auth/sign-in/social',{
    method:'POST',headers:{origin,'content-type':'application/json','x-captcha-response':'local-only',
      'cf-connecting-ip':`192.0.2.${i+1}`},body:JSON.stringify({provider:'github',callbackURL:origin}),
  })));
  assert.ok(initiations.every(r=>r.status===200),'all synthetic initiations succeed without provider authorization');
  const initiation=initiations[19];
  const state=new URL((await initiation.json()).url).searchParams.get('state');
  const cookie=initiation.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const callback=await mf.dispatchFetch(origin+'/api/auth/callback/github?code=local-only&state='+encodeURIComponent(state),
    {redirect:'manual',headers:{cookie,'cf-connecting-ip':'192.0.2.20'}});
  assert.equal(callback.status,302);
  assert.equal(callback.headers.get('location'),origin);
  const oauthCallback=JSON.parse(callback.headers.get('x-probe-d1'));
  assert.ok(oauthCallback.rowsRead < 100,'returning login must not scan 1,000 provider accounts');
  const sessionCookies = callback.headers.getSetCookie().filter(value=>value.includes('session_token='));
  assert.equal(sessionCookies.length,1);
  for (const attribute of [/; Secure/i,/; HttpOnly/i,/; SameSite=Lax/i]) assert.match(sessionCookies[0],attribute);
  assert.doesNotMatch(sessionCookies[0],/; Domain=/i,'session cookie must be host-only');
  await callback.arrayBuffer();
  const sessionCount = async () => (await db.prepare('SELECT COUNT(*) AS n FROM probe_session').first()).n;
  const beforeRejected = await sessionCount();
  // Replay and mismatched/missing state must never mint another session.
  const unconsumedState = new URL((await initiations[18].clone().json()).url).searchParams.get('state');
  const wrongAttemptCookie = initiations[17].headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  for (const [rejectedState, rejectedCookie] of [[state,cookie],['wrong-local-state',cookie],
    [unconsumedState,''],[unconsumedState,wrongAttemptCookie]]) {
    const rejected = await mf.dispatchFetch(origin+'/api/auth/callback/github?code=local-only&state='+encodeURIComponent(rejectedState),
      {redirect:'manual',headers:{cookie:rejectedCookie,'cf-connecting-ip':'192.0.2.21'}});
    assert.equal(rejected.status,302);
    assert.notEqual(rejected.headers.get('location'),origin);
    assert.ok(!rejected.headers.getSetCookie().some(value=>/session_token=[^;]/.test(value)),'rejected callback must not issue a session');
    await rejected.arrayBuffer();
    assert.equal(await sessionCount(),beforeRejected);
  }
  const post = (path,body,headers={}) => mf.dispatchFetch(origin+path,{method:'POST',
    headers:{origin,'content-type':'application/json','cf-connecting-ip':'192.0.2.22',...headers},body:JSON.stringify(body)});
  for (const callbackURL of ['https://evil.example/','//evil.example/','javascript:alert(1)']) {
    const rejected = await post('/api/auth/sign-in/social',{provider:'github',callbackURL},{'x-captcha-response':'local-only'});
    assert.equal(rejected.status,403,'unsafe callback URL must fail closed');
    await rejected.arrayBuffer();
  }
  // JSON mutations require the exact origin, even with a valid session cookie.
  for (const badOrigin of ['', 'https://other-probe.example.workers.dev']) {
    const rejected = await post('/api/auth/sign-out',{}, {cookie:credentials[4].headers.get('cookie'),origin:badOrigin});
    assert.equal(rejected.status,403);
    await rejected.arrayBuffer();
    await check(4);
  }
  for (const path of ['/api/auth/passkey/verify-authentication','/api/auth/passkey/verify-registration']) {
    const rejected = await post(path,{response:{id:'not-a-credential',rawId:'',type:'public-key',response:{}}});
    assert.ok([400,401].includes(rejected.status),'malformed ceremony must be rejected');
    await rejected.arrayBuffer();
    assert.equal(await sessionCount(),beforeRejected);
  }
  await db.prepare('UPDATE probe_session SET createdAt = ? WHERE userId = ?').bind(Date.now()-600000,credentials[5].user.id).run();
  const staleRegistration = await mf.dispatchFetch(origin+'/api/auth/passkey/generate-register-options',{headers:credentials[5].headers});
  assert.equal(staleRegistration.status,403,'enrollment requires a fresh session');
  await staleRegistration.arrayBuffer();
  const staleRemoval = await post('/api/auth/passkey/delete-passkey',{id:'not-a-credential'},{cookie:credentials[5].headers.get('cookie')});
  assert.equal(staleRemoval.status,403,'removal requires a fresh session');
  await staleRemoval.arrayBuffer();
  await Promise.all(initiations.slice(0,19).map(r=>r.arrayBuffer()));
  await db.prepare('DELETE FROM probe_session WHERE userId = ?').bind(credentials[0].user.id).run();
  assert.equal((await mf.dispatchFetch(origin+'/probe/session/reused',{headers:credentials[0].headers})).status,401);
  // Exercise the library's window-reset cleanup against 1,000 live limiter rows.
  // All fixture writes remain local; no synthetic credentials enter the live probe.
  const sessionResponse=await mf.dispatchFetch(origin+'/api/auth/get-session',{headers:credentials[3].headers});
  assert.equal(sessionResponse.status,200);
  await sessionResponse.arrayBuffer();
  const sessionKeys=await db.prepare("SELECT key FROM probe_rate_limit WHERE key LIKE '%/get-session%'").all();
  assert.equal(sessionKeys.results.length,1);
  const sessionKey=sessionKeys.results[0].key;
  await db.prepare('DELETE FROM probe_rate_limit').run();
  const now=Date.now();
  for(let i=0;i<1000;i+=50) await db.batch(Array.from({length:50},(_,j)=>
    db.prepare('INSERT INTO probe_rate_limit (id,key,count,lastRequest) VALUES (?,?,?,?)')
      .bind(`local-rate-${i+j}`,`local-rate-${i+j}`,1,now)));
  await db.prepare('INSERT INTO probe_rate_limit (id,key,count,lastRequest) VALUES (?,?,?,?)')
    .bind('local-expired-rate',sessionKey,1,now-120000).run();
  const cleanupResponse=await mf.dispatchFetch(origin+'/api/auth/get-session',{headers:credentials[3].headers});
  assert.equal(cleanupResponse.status,200);
  await cleanupResponse.arrayBuffer();
  const cleanup=JSON.parse(cleanupResponse.headers.get('x-probe-d1'));
  assert.ok(cleanup.rowsRead < 30,'library cleanup must not scan 1,000 live limiter rows');
  assert.ok(cleanup.rowsWritten >= 2,'account for the supplemental index write');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM probe_rate_limit').first()).n,1001,'live limits are retained');
  // A limit near exhaustion must survive object eviction, and concurrent calls
  // cannot both consume the final slot. No client identity headers reset it.
  await db.prepare('UPDATE probe_rate_limit SET count = 99, lastRequest = ? WHERE key = ?').bind(Date.now(),sessionKey).run();
  await mf.unsafeEvictDurableObject('runtime','AuthProbe',{name:'auth'});
  const limited = await Promise.all([0,1].map(i=>mf.dispatchFetch(origin+'/api/auth/get-session',{
    headers:{cookie:credentials[3].headers.get('cookie'),'x-forwarded-for':`192.0.2.${30+i}`,'x-auth-user':`fake-${i}`}})));
  assert.deepEqual(limited.map(r=>r.status).sort(),[200,429],'persistent limit has exactly one remaining slot');
  await Promise.all(limited.map(r=>r.arrayBuffer()));
  const retry = await mf.dispatchFetch(origin+'/api/auth/get-session',{headers:credentials[3].headers});
  assert.equal(retry.status,429);
  assert.ok(Number(retry.headers.get('x-retry-after'))>0);
  await retry.arrayBuffer();
  console.log(JSON.stringify({security:{oauthReplay:'passed',stateMismatch:'passed',unsafeReturn:'passed',csrf:'passed',malformedPasskey:'passed',freshCredentials:'passed',persistentConcurrentLimit:'passed'},localOnly:true,accounts:1000,concurrentSessions:50,loginInitiations:20,cold,warm:burst[0],refresh,oauthCallback,cleanup,coldBurst:{requests:afterEviction.length,initializations:afterEviction.filter(m=>m.initialized).length,rowsRead:afterEviction.reduce((n,m)=>n+m.rowsRead,0)},expiry:'passed',revocation:'passed'}));
} finally {local.close();await mf.dispose();}
