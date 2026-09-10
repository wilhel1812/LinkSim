export const routes = new Map([
  ['/api/auth/sign-in/social', 'POST'], ['/api/auth/callback/github', 'GET'],
  ['/api/auth/get-session', 'GET'], ['/api/auth/sign-out', 'POST'],
  ['/api/auth/passkey/generate-register-options', 'GET'],
  ['/api/auth/passkey/verify-registration', 'POST'],
  ['/api/auth/passkey/generate-authenticate-options', 'GET'],
  ['/api/auth/passkey/verify-authentication', 'POST'],
  ['/api/auth/passkey/list-user-passkeys', 'GET'],
  ['/api/auth/passkey/delete-passkey', 'POST'],
]);

export const securityHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" };
export function enabled(request, env) {
  return env.PROBE_ENABLED === 'github-passkey-validation' && /^\d+$/.test(env.PROBE_GITHUB_ID ?? '') &&
    Date.parse(env.PROBE_EXPIRES_AT) > Date.now() && new URL(request.url).origin === env.PROBE_ORIGIN;
}
export function isBenchmark(request) {
  return request.method === 'GET' && ['/probe/session/reused', '/probe/session/fresh'].includes(new URL(request.url).pathname);
}
