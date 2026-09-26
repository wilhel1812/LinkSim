#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ONE_HOUR = 60 * 60_000;
const ONE_DAY = 24 * ONE_HOUR;
const ONE_WEEK = 7 * ONE_DAY;
const MAX_RESPONSE_BYTES = 64 * 1024;
const allowedHosts = new Set(['linksim.link', 'staging.linksim.link']);

class AuthCanaryError extends Error {
  constructor(message, rollbackEligible = false, retryable = rollbackEligible) {
    super(message);
    this.rollbackEligible = rollbackEligible;
    this.retryable = retryable;
  }
}

const canaryEndpoint = value => {
  let url;
  try { url = new URL(value); } catch { throw Error('Authentication canary URL must be a valid LinkSim HTTPS URL.'); }
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.pathname !== '/api/me' ||
      url.search || url.hash || url.username || url.password) {
    throw Error('Authentication canary URL must be the production or staging /api/me HTTPS endpoint.');
  }
  return url.href;
};

const requestOnce = async ({ endpoint, cookie, expectedUserId, fetchImpl, timeoutMs }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'application/json', cookie },
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        throw new AuthCanaryError('the authenticated profile request timed out.', true);
      }
      throw new AuthCanaryError('the authenticated profile request could not reach LinkSim.', true);
    }
    if (response.status >= 300 && response.status < 400) throw new AuthCanaryError(`LinkSim returned an unexpected redirect (HTTP ${response.status}).`);
    if (response.status === 401 || response.status === 403) throw new AuthCanaryError(`the canary session was rejected (HTTP ${response.status}).`, true);
    if (response.status >= 500) throw new AuthCanaryError(`LinkSim returned a retryable server error (HTTP ${response.status}).`, true);
    if (response.status >= 400 && response.status < 500) {
      throw new AuthCanaryError(`LinkSim returned a non-rollback client error (HTTP ${response.status}).`);
    }
    if (response.status !== 200) throw new AuthCanaryError(`LinkSim returned an unexpected status (HTTP ${response.status}).`);
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      throw new AuthCanaryError('LinkSim returned an invalid JSON profile response.');
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new AuthCanaryError('LinkSim returned an oversized profile response.');
    }
    let raw;
    try {
      raw = await response.text();
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        throw new AuthCanaryError('the authenticated profile request timed out.', true);
      }
      throw new AuthCanaryError('the authenticated profile response could not be read.', true);
    }
    if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new AuthCanaryError('LinkSim returned an oversized profile response.');
    let body;
    try { body = JSON.parse(raw); } catch { throw new AuthCanaryError('LinkSim returned an invalid JSON profile response.'); }
    if (body?.user?.id !== expectedUserId) {
      throw new AuthCanaryError('LinkSim authenticated an unexpected LinkSim account.', true, false);
    }
    return { userId: body.user.id };
  } finally {
    clearTimeout(timeout);
  }
};

export async function runAuthCanary({ endpoint, cookie, expectedUserId, fetchImpl = fetch, timeoutMs = 10_000 }) {
  const safeEndpoint = canaryEndpoint(endpoint);
  if (typeof cookie !== 'string' || !cookie.trim() || /[\r\n]/.test(cookie)) {
    throw Error('Authentication canary cookie is missing or invalid.');
  }
  if (typeof expectedUserId !== 'string' || !expectedUserId.trim()) {
    throw Error('Authentication canary expected user ID is missing.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw Error('Authentication canary timeout is invalid.');
  }
  let reason = 'the authenticated profile check failed.';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await requestOnce({ endpoint: safeEndpoint, cookie, expectedUserId, fetchImpl, timeoutMs });
      return { attempts: attempt, ...result };
    } catch (error) {
      reason = error instanceof Error ? error.message : reason;
      if (error instanceof AuthCanaryError && !error.retryable) {
        if (error.rollbackEligible) {
          throw new AuthCanaryError(`Authentication canary found an immediate rollback trigger: ${reason}`, true, false);
        }
        throw new AuthCanaryError(`Authentication canary failed without a rollback trigger: ${reason}`, false, false);
      }
    }
  }
  throw new AuthCanaryError(`Authentication canary failed after retry: ${reason}`, true);
}

export function getAuthCanaryCadence(cutoverAt, now = Date.now()) {
  const cutover = Date.parse(cutoverAt);
  if (!Number.isFinite(cutover) || !String(cutoverAt).endsWith('Z')) {
    throw Error('Authentication canary cutover time must be a valid UTC timestamp.');
  }
  if (!Number.isFinite(now)) throw Error('Authentication canary current time is invalid.');
  const elapsed = now - cutover;
  if (elapsed < 0) return { due: false, phase: 'before-cutover' };
  if (elapsed < ONE_HOUR) return { due: false, phase: 'first-hour' };
  if (elapsed < ONE_DAY) return { due: true, phase: 'first-day' };
  if (elapsed >= ONE_WEEK) return { due: false, phase: 'complete' };
  return { due: true, phase: 'first-week' };
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  if (command === 'probe') {
    const result = await runAuthCanary({
      endpoint: process.env.AUTH_CANARY_URL,
      cookie: process.env.AUTH_CANARY_COOKIE,
      expectedUserId: process.env.AUTH_CANARY_EXPECTED_USER_ID,
    });
    process.stdout.write(`Authentication canary passed after ${result.attempts} attempt${result.attempts === 1 ? '' : 's'}.\n`);
    return;
  }
  if (command === 'cadence') {
    const result = getAuthCanaryCadence(argument);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw Error('Usage: auth-canary.mjs probe | cadence <cutover-utc>');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Authentication canary failed.'}\n`);
    process.exitCode = error instanceof AuthCanaryError && error.rollbackEligible ? 1 : 2;
  });
}
