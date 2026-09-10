import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { testUtils } from 'better-auth/plugins';
import { liveOptions, createLiveWorker } from './live.mjs';
import synthetic from './worker.mjs';

const origin = 'https://linksim-auth-probe-test.example.workers.dev';
const configuration = () => ({ PROBE_ENABLED: 'github-passkey-validation', PROBE_ORIGIN: origin,
  PROBE_GITHUB_ID: '88513', PROBE_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString(),
  GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret',
  BETTER_AUTH_SECRET: 'validation-secret-with-at-least-32-characters' });

test('live harness fails closed before DB access for missing configuration or expired tests', async () => {
  const worker = createLiveWorker({ page: 'test', script: 'test' });
  for (const env of [{}, { ...configuration(), PROBE_EXPIRES_AT: 'invalid' },
    { ...configuration(), PROBE_EXPIRES_AT: new Date(0).toISOString() },
    { ...configuration(), GITHUB_CLIENT_SECRET: '' }]) {
    const response = await worker.fetch(new Request(origin), env);
    assert.equal(response.status, 404);
  }
});

test('only the configured stable GitHub subject can supply a login profile', async () => {
  const options = liveOptions(configuration());
  assert.deepEqual(Object.keys(options.socialProviders), ['github']);
  const map = options.socialProviders.github.mapProfileToUser;
  assert.throws(() => map({ id: 999, login: 'wilhel1812' }), /not enabled/);
  assert.doesNotThrow(() => map({ id: 88513, login: 'renamed-user' }));
  assert.equal(options.account.accountLinking.enabled, false);
  assert.equal(options.session.cookieCache.enabled, false);
});

test('real-provider secrets disable the synthetic fixture wrapper', async () => {
  const response = await synthetic.fetch(new Request(`${origin}/probe/fixture`, {
    method: 'POST', headers: { authorization: 'Bearer test' },
  }), { ...configuration(), PROBE_ENABLED: 'isolated-auth-probe', PROBE_KEY: 'test' });
  assert.equal(response.status, 404);
});

test('pending schema checks are not cached across requests or abandoned after a response', async () => {
  let finishSchema;
  const pendingSchema = new Promise(resolve => { finishSchema = resolve; });
  let creations = 0;
  const worker = createLiveWorker({ page: 'test', script: 'test' }, () => {
    const first = ++creations === 1;
    return { $context: Promise.resolve({ checkSchema: () => first ? pendingSchema : undefined }),
      handler: async () => Response.json(null) };
  });
  const controller = new AbortController();
  const env = { ...configuration(), DB: {} };
  let finished = false;
  const first = worker.fetch(new Request(`${origin}/api/auth/get-session`, { signal: controller.signal }), env)
    .then(response => { finished = true; return response; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false, 'response must retain the request until schema validation finishes');
    controller.abort();
    const second = await worker.fetch(new Request(`${origin}/api/auth/get-session`), env);
    assert.equal(second.status, 200);
    assert.equal(creations, 2, 'next request must not inherit pending initialization');
  } finally { finishSchema(); await first; }
  await worker.fetch(new Request(`${origin}/api/auth/get-session`), env);
  assert.equal(creations, 2, 'the completed healthy instance remains reusable');
});

async function fixture() {
  const db = new DatabaseSync(':memory:');
  const env = { ...configuration(), DB: db };
  const options = liveOptions(env);
  const migration = await getMigrations(options);
  await migration.runMigrations();
  // Synthetic helpers are strictly local test dependencies, never live plugins.
  const auth = betterAuth({ ...options, plugins: [...options.plugins, testUtils()] });
  const { test } = await auth.$context;
  const user = await test.saveUser(test.createUser({ email: 'test@example.invalid', emailVerified: false }));
  const { headers } = await test.login({ userId: user.id });
  headers.set('origin', origin);
  headers.set('cf-connecting-ip', '192.0.2.1');
  return { db, env, headers };
}

test('live routes exclude fixture/linking and enforce origin, freshness and session revocation', async () => {
  const { db, env, headers } = await fixture();
  const worker = createLiveWorker({ page: 'test', script: 'test' });
  const request = (path, method = 'GET', h = headers, body) => worker.fetch(new Request(origin + path,
    { method, headers: body ? new Headers([...h, ['content-type', 'application/json']]) : h,
      body: body ? JSON.stringify(body) : undefined }), env);
  try {
    for (const path of ['/probe/fixture', '/api/auth/link-social', '/api/auth/unlink-account']) {
      assert.equal((await request(path, 'POST')).status, 404);
    }
    const wrongOrigin = new Headers(headers);
    wrongOrigin.set('origin', 'https://evil.example');
    assert.equal((await request('/api/auth/sign-out', 'POST', wrongOrigin, {})).status, 403);
    for (const path of ['/probe/session/reused', '/probe/session/fresh']) {
      const response = await request(path);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { authenticated: true, emailVerified: false });
    }
    const concurrent = await Promise.all(Array.from({ length: 3 }, () => request('/probe/session/reused')));
    for (const response of concurrent) {
      assert.equal(response.status, 200);
      const metrics = JSON.parse(response.headers.get('x-probe-d1'));
      assert.equal(metrics.initialized, false);
      assert.ok(metrics.queries > 0);
    }
    // The actual library session freshness policy must protect credential removal.
    db.prepare('UPDATE probe_session SET createdAt = ?').run(Date.now() - 600000);
    assert.equal((await request('/api/auth/passkey/delete-passkey', 'POST', headers, { id: 'missing' })).status, 403);
    const signedOut = await request('/api/auth/sign-out', 'POST', headers, {});
    assert.equal(signedOut.status, 200);
    const revoked = await request('/probe/session/reused');
    assert.equal(revoked.status, 401);
    assert.deepEqual(await revoked.json(), { authenticated: false });
  } finally { db.close(); }
});

test('library OAuth callbacks enforce tester identity and reject state replay', async t => {
  let subject = 999;
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input);
    if (url.hostname === 'challenges.cloudflare.com') return Response.json({ success: true });
    if (url.hostname === 'github.com' && url.pathname === '/login/oauth/access_token') {
      return Response.json({ access_token: 'synthetic-provider-token', token_type: 'bearer', scope: 'read:user,user:email' });
    }
    if (url.hostname === 'api.github.com' && url.pathname === '/user') {
      return Response.json({ id: subject, login: 'tester', name: 'Tester', email: 'test@example.invalid' });
    }
    if (url.hostname === 'api.github.com' && url.pathname === '/user/emails') {
      return Response.json([{ email: 'test@example.invalid', primary: true, verified: true }]);
    }
    throw new Error('Unexpected provider request');
  });
  const db = new DatabaseSync(':memory:');
  const env = { ...configuration(), DB: db };
  await (await getMigrations(liveOptions(env))).runMigrations();
  const worker = createLiveWorker({ page: 'test', script: 'test' });
  async function initiate(ip) {
    const response = await worker.fetch(new Request(`${origin}/api/auth/sign-in/social`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json',
        'cf-connecting-ip': ip, 'x-captcha-response': 'test-token' },
      body: JSON.stringify({ provider: 'github', callbackURL: '/' }),
    }), env);
    assert.equal(response.status, 200);
    const state = new URL((await response.json()).url).searchParams.get('state');
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    return new Request(`${origin}/api/auth/callback/github?code=test-code&state=${encodeURIComponent(state)}`,
      { headers: { cookie, 'cf-connecting-ip': ip } });
  }
  try {
    await worker.fetch(await initiate('192.0.2.10'), env);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM probe_user').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM probe_session').get().n, 0);
    subject = 88513;
    const callback = await initiate('192.0.2.11');
    const response = await worker.fetch(callback.clone(), env);
    assert.equal(response.status, 302);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM probe_session').get().n, 1);
    assert.equal(db.prepare('SELECT emailVerified FROM probe_user').get().emailVerified, 1);
    assert.equal(db.prepare('SELECT accountId FROM probe_account').get().accountId, '88513');
    const replay = await worker.fetch(callback.clone(), env);
    assert.match(replay.headers.get('location'), /error/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM probe_session').get().n, 1);
  } finally { db.close(); }
});
