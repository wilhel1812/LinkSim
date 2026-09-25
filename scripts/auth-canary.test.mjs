import { describe, expect, it, vi } from 'vitest';
import { getAuthCanaryCadence, runAuthCanary } from './auth-canary.mjs';

const options = {
  endpoint: 'https://staging.linksim.link/api/me',
  cookie: '__Secure-better-auth.session_token=secret-value',
  expectedUserId: 'canary-user',
  timeoutMs: 1_000,
};

describe('authenticated production canary', () => {
  it('accepts only the expected LinkSim user and does not follow redirects', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ user: { id: 'canary-user' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(runAuthCanary({ ...options, fetchImpl })).resolves.toEqual({ attempts: 1, userId: 'canary-user' });
    expect(fetchImpl).toHaveBeenCalledWith(options.endpoint, expect.objectContaining({
      redirect: 'manual',
      headers: expect.objectContaining({
        accept: 'application/json',
        cookie: options.cookie,
      }),
    }));
  });

  it('retries once after a qualifying failure', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('temporary', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'canary-user' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    await expect(runAuthCanary({ ...options, fetchImpl })).resolves.toEqual({ attempts: 2, userId: 'canary-user' });
  });

  it('fails safely after two attempts without disclosing the cookie or response body', async () => {
    const fetchImpl = vi.fn(async () => new Response('private upstream details', { status: 401 }));
    let message = '';
    try {
      await runAuthCanary({ ...options, fetchImpl });
    } catch (error) {
      message = error.message;
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(message).toBe('Authentication canary failed after retry: the canary session was rejected (HTTP 401).');
    expect(message).not.toContain('secret-value');
    expect(message).not.toContain('private upstream details');
  });

  it('rejects redirects, invalid JSON, and a different authenticated user', async () => {
    await expect(runAuthCanary({
      ...options,
      fetchImpl: vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://login.example' } })),
    })).rejects.toThrow('unexpected redirect');
    await expect(runAuthCanary({
      ...options,
      fetchImpl: vi.fn(async () => new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } })),
    })).rejects.toThrow('invalid JSON');
    await expect(runAuthCanary({
      ...options,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ user: { id: 'other-user' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    })).rejects.toThrow('unexpected LinkSim account');
  });

  it('refuses an arbitrary endpoint and cookie header injection', async () => {
    await expect(runAuthCanary({
      ...options,
      endpoint: 'https://attacker.example/api/me',
      fetchImpl: vi.fn(),
    })).rejects.toThrow('production or staging /api/me');
    await expect(runAuthCanary({
      ...options,
      cookie: 'session=value\r\nx-leak: yes',
      fetchImpl: vi.fn(),
    })).rejects.toThrow('cookie is missing or invalid');
  });
});

describe('production canary cadence', () => {
  const cutover = Date.parse('2026-10-01T12:03:00Z');
  const cadence = minutes => getAuthCanaryCadence(new Date(cutover).toISOString(), cutover + minutes * 60_000);

  it('leaves the first hour to the protected continuous monitor', () => {
    expect(cadence(-1)).toEqual({ due: false, phase: 'before-cutover' });
    expect(cadence(0)).toEqual({ due: false, phase: 'first-hour' });
    expect(cadence(59)).toEqual({ due: false, phase: 'first-hour' });
  });

  it('runs every scheduled five-minute tick for the rest of day one', () => {
    expect(cadence(60)).toEqual({ due: true, phase: 'first-day' });
    expect(cadence(23 * 60)).toEqual({ due: true, phase: 'first-day' });
  });

  it('selects one of every three five-minute ticks through day seven and then stops', () => {
    expect(cadence(24 * 60)).toEqual({ due: true, phase: 'first-week' });
    expect(cadence(24 * 60 + 5)).toEqual({ due: false, phase: 'first-week' });
    expect(cadence(24 * 60 + 15)).toEqual({ due: true, phase: 'first-week' });
    expect(cadence(7 * 24 * 60)).toEqual({ due: false, phase: 'complete' });
  });

  it('rejects an invalid cutover timestamp', () => {
    expect(() => getAuthCanaryCadence('not-a-date', Date.now())).toThrow('valid UTC');
  });
});
