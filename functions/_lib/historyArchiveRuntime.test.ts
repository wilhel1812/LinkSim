import { expect, it, vi } from 'vitest';
import gateway from '../../experiments/better-auth/history-archive-gateway';

const request = (path: string, key = 'synthetic-key', extra: Record<string, string> = {}) =>
  new Request(`https://synthetic.example${path}`, { method: 'POST', headers: { authorization: `Bearer ${key}`, ...extra } });

it('rejects unauthenticated, expired and unknown routes before reaching the private object', async () => {
  const fetch = vi.fn();
  const env = { PROBE_ENABLED: 'synthetic-history-r2', PROBE_KEY: 'synthetic-key',
    PROBE_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(), ARCHIVE: { getByName: () => ({ fetch }) } };
  expect((await gateway.fetch(request('/archive', 'wrong'), env as never)).status).toBe(404);
  expect((await gateway.fetch(request('/other'), env as never)).status).toBe(404);
  expect((await gateway.fetch(request('/archive'), { ...env, PROBE_EXPIRES_AT: '2020-01-01' } as never)).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});

it('passes only the probe credential to the private object and bounds response errors', async () => {
  const fetch = vi.fn(async (forwarded: Request) => {
    expect(forwarded.headers.get('authorization')).toBe('Bearer synthetic-key');
    expect(forwarded.headers.get('x-auth-user')).toBeNull();
    expect(forwarded.headers.get('cookie')).toBeNull();
    return Response.json({ ok: true });
  });
  const env = { PROBE_ENABLED: 'synthetic-history-r2', PROBE_KEY: 'synthetic-key',
    PROBE_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(), ARCHIVE: { getByName: () => ({ fetch }) } };
  expect((await gateway.fetch(request('/archive?id=1', 'synthetic-key', { 'x-auth-user': 'admin', cookie: 'private' }), env as never)).status).toBe(200);
  fetch.mockRejectedValueOnce(new Error('private object failure'));
  const unavailable = await gateway.fetch(request('/archive'), env as never);
  expect(unavailable.status).toBe(503);
  expect(await unavailable.text()).not.toContain('private object failure');
});
