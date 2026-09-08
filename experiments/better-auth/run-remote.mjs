import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('wrangler.probe.jsonc', 'utf8'));
const secrets = JSON.parse(readFileSync('.probe-secrets.json', 'utf8'));
const origin = config.vars.PROBE_ORIGIN;
assert.match(config.name, /^linksim-auth-probe-/);
const target = new URL(origin);
assert.equal(target.protocol, 'https:');
assert.equal(target.origin, origin);
assert.ok(target.hostname.startsWith(`${config.name}.`) && target.hostname.endsWith('.workers.dev'));
assert.equal(config.d1_databases.length, 1);
assert.equal(config.d1_databases[0].database_name, config.name);
const results = [];
async function call(path, { method = 'GET', cookie, body, captcha = false, expected = 200 } = {}) {
  const headers = new Headers({ authorization: `Bearer ${secrets.PROBE_KEY}`, origin });
  if (cookie) headers.set('cookie', cookie);
  if (body) headers.set('content-type', 'application/json');
  if (captcha) headers.set('x-captcha-response', 'XXXX.DUMMY.TOKEN.XXXX');
  const start = Date.now();
  const response = await fetch(`${origin}${path}`, { method, headers,
    body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  const payload = await response.text();
  const record = { path, status: response.status, expected, wallMs: Date.now() - start,
    d1: JSON.parse(response.headers.get('x-probe-d1') ?? 'null') };
  results.push(record);
  console.log(JSON.stringify(record));
  assert.equal(response.status, expected, `${path}: unexpected response (body omitted)`);
  return { payload, headers: response.headers };
}
try {
  const anonymous = await fetch(`${origin}/api/auth/get-session`);
  assert.equal(anonymous.status, 404, 'probe must not be publicly usable');
  const fixture = await call('/probe/fixture', { method: 'POST' });
  const { cookie } = JSON.parse(fixture.payload);
  assert.ok(cookie);
  for (let i = 0; i < 10; i++) {
    await call('/api/auth/get-session', { cookie });
  }
  for (let i = 0; i < 3; i++) {
    await call('/api/auth/passkey/generate-register-options', { cookie });
  }
  for (const provider of ['github', 'gitlab']) {
    // Better Auth's built-in social-login rule is stricter than the global rule.
    // Separate the provider pairs instead of weakening that rule for the probe.
    if (provider === 'gitlab') await new Promise(resolve => setTimeout(resolve, 11000));
    await call('/api/auth/sign-in/social', { method: 'POST', body: { provider, callbackURL: '/' }, expected: 400 });
    await call('/api/auth/sign-in/social', { method: 'POST', captcha: true, body: { provider, callbackURL: '/' } });
  }
  await call('/api/auth/sign-out', { method: 'POST', cookie, body: {} });
  const loggedOut = await call('/api/auth/get-session', { cookie });
  assert.equal(JSON.parse(loggedOut.payload), null);
} finally {
  writeFileSync('probe-results.json', JSON.stringify({ origin, completedAt: new Date().toISOString(), results }, null, 2));
}
