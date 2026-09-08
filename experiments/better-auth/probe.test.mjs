import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { testUtils } from 'better-auth/plugins';
import { probeOptions } from './probe.mjs';
import worker from './worker.mjs';
import { readFileSync } from 'node:fs';

const origin = 'https://auth-probe.example';
const env = { PROBE_ORIGIN: origin, BETTER_AUTH_SECRET: 'disposable-test-secret-with-at-least-32-characters' };

async function fixture() {
  const db = new DatabaseSync(':memory:');
  const options = probeOptions({ ...env, DB: db });
  const migration = await getMigrations(options);
  await migration.runMigrations();
  const auth = betterAuth({ ...options, plugins: [...options.plugins, testUtils()] });
  const ctx = await auth.$context;
  const user = await ctx.test.saveUser(ctx.test.createUser({ email: 'probe@example.invalid' }));
  const { headers } = await ctx.test.login({ userId: user.id });
  headers.set('origin', origin);
  headers.set('cf-connecting-ip', '192.0.2.1');
  return { db, auth, headers, user };
}

test('disposable Worker rejects missing or incorrect probe credentials before touching D1', async () => {
  for (const config of [{}, { PROBE_ENABLED: 'isolated-auth-probe', PROBE_KEY: 'test' }]) {
    const response = await worker.fetch(new Request(`${origin}/probe/fixture`, { method: 'POST' }), config);
    assert.equal(response.status, 404);
  }
});

test('checked-in fixture schema matches the pinned library generator', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    const migration = await getMigrations(probeOptions({ ...env, DB: database }));
    assert.equal(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'), await migration.compileMigrations());
  } finally { database.close(); }
});

test('real library creates only namespaced tables and resolves/revokes a DB session', async () => {
  const { db, auth, headers, user } = await fixture();
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    assert.ok(tables.includes('probe_passkey'));
    assert.ok(tables.every(name => name.startsWith('probe_')));
    const response = await auth.handler(new Request(`${origin}/api/auth/get-session`, { headers }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.id, user.id);
    const logout = await auth.handler(new Request(`${origin}/api/auth/sign-out`, { method: 'POST', headers }));
    assert.equal(logout.status, 200);
    const after = await auth.handler(new Request(`${origin}/api/auth/get-session`, { headers }));
    assert.equal(await after.json(), null);
  } finally { db.close(); }
});

test('passkey registration requires a session and persists the challenge', async () => {
  const { db, auth, headers } = await fixture();
  try {
    const url = `${origin}/api/auth/passkey/generate-register-options`;
    const anonymous = await auth.handler(new Request(url));
    assert.equal(anonymous.status, 401);
    const response = await auth.handler(new Request(url, { headers }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.rp.id, 'auth-probe.example');
    assert.ok(body.challenge);
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM probe_verification').get().n > 0);
  } finally { db.close(); }
});

test('OAuth initiation requires Turnstile and cross-origin mutation is rejected', async () => {
  const { db, auth, headers } = await fixture();
  try {
    for (const provider of ['github', 'gitlab']) {
      const response = await auth.handler(new Request(`${origin}/api/auth/sign-in/social`, {
        method: 'POST', headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ provider, callbackURL: '/' }),
      }));
      assert.equal(response.status, 400);
    }
    headers.set('origin', 'https://untrusted.example');
    const response = await auth.handler(new Request(`${origin}/api/auth/sign-out`, { method: 'POST', headers }));
    assert.equal(response.status, 403);
    const callback = await auth.handler(new Request(`${origin}/api/auth/callback/github?code=fake&state=fake`));
    assert.match(callback.headers.get('location') ?? '', /state|error/);
  } finally { db.close(); }
});
