// Local workerd/D1 integration only. Synthetic identities never enter the live probe.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { testUtils } from 'better-auth/plugins';
import { liveOptions } from './live.mjs';
const origin='https://linksim-auth-probe-local.example.workers.dev';
const vars={PROBE_ENABLED:'github-passkey-validation',PROBE_ORIGIN:origin,PROBE_GITHUB_ID:'88513',
  PROBE_EXPIRES_AT:new Date(Date.now()+3600000).toISOString(),GITHUB_CLIENT_ID:'local-only',
  GITHUB_CLIENT_SECRET:'local-only',BETTER_AUTH_SECRET:'local-only-secret-at-least-32-characters'};
const common={modules:true,compatibilityDate:'2026-03-12',compatibilityFlags:['nodejs_compat'],bindings:vars};
const mf=new Miniflare(convertV4MiniflareOptions({workers:[
  {...common,name:'gateway',scriptPath:'.wrangler/durable-gateway/durable-gateway-worker.js',
    durableObjects:{AUTH:{className:'AuthProbe',scriptName:'runtime',useSQLite:true}}},
  {...common,name:'runtime',scriptPath:'.wrangler/durable-runtime/durable-runtime.js',d1Databases:['DB'],
    durableObjects:{AUTH:{className:'AuthProbe',useSQLite:true}},
    outboundService:request=>new URL(request.url).hostname==='challenges.cloudflare.com'
      ? Response.json({success:true}) : new Response(null,{status:403})},
]}));
const local=new DatabaseSync(':memory:');
try {
  const options=liveOptions({...vars,DB:local});
  await (await getMigrations(options)).runMigrations();
  const auth=betterAuth({...options,plugins:[...options.plugins,testUtils()]});
  const {test}=await auth.$context;
  const credentials=[];
  for(let i=0;i<1000;i++) {
    const user=await test.saveUser(test.createUser({email:`local-${i}@example.invalid`,emailVerified:i%2===0}));
    if(i<50) credentials.push({user,headers:(await test.login({userId:user.id})).headers});
  }
  const db=await mf.getD1Database('DB','runtime');
  for(const sql of readFileSync('schema.sql','utf8').split(';').filter(s=>s.trim())) await db.prepare(sql).run();
  for(const table of ['probe_user','probe_session']) {
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
  const initiations=await Promise.all(Array.from({length:20},(_,i)=>mf.dispatchFetch(origin+'/api/auth/sign-in/social',{
    method:'POST',headers:{origin,'content-type':'application/json','x-captcha-response':'local-only',
      'cf-connecting-ip':`192.0.2.${i+1}`},body:JSON.stringify({provider:'github',callbackURL:origin}),
  })));
  assert.ok(initiations.every(r=>r.status===200),'all synthetic initiations succeed without provider authorization');
  await Promise.all(initiations.map(r=>r.arrayBuffer()));
  await db.prepare('DELETE FROM probe_session WHERE userId = ?').bind(credentials[0].user.id).run();
  assert.equal((await mf.dispatchFetch(origin+'/probe/session/reused',{headers:credentials[0].headers})).status,401);
  console.log(JSON.stringify({localOnly:true,accounts:1000,concurrentSessions:50,loginInitiations:20,cold,warm:burst[0],revocation:'passed'}));
} finally {local.close();await mf.dispose();}
