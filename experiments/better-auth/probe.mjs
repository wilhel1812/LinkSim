import { betterAuth } from 'better-auth';
import { captcha } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';

// Disposable experiment only. Never import this configuration into LinkSim.
export function probeOptions(env) {
  const origin = new URL(env.PROBE_ORIGIN).origin;
  return {
    appName: 'LinkSim auth compatibility probe',
    baseURL: origin,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [origin],
    emailAndPassword: { enabled: false },
    user: { modelName: 'probe_user' },
    account: {
      modelName: 'probe_account',
      accountLinking: { enabled: true, disableImplicitLinking: true, allowUnlinkingAll: false },
    },
    session: {
      modelName: 'probe_session',
      cookieCache: { enabled: false },
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 5,
    },
    verification: { modelName: 'probe_verification' },
    advanced: {
      useSecureCookies: true,
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    rateLimit: { enabled: true, storage: 'database', modelName: 'probe_rate_limit', window: 60, max: 100 },
    socialProviders: {
      github: { clientId: 'probe-not-a-real-oauth-client', clientSecret: 'probe-not-a-real-oauth-secret' },
      gitlab: { clientId: 'probe-not-a-real-oauth-client', clientSecret: 'probe-not-a-real-oauth-secret' },
    },
    plugins: [
      passkey({ rpID: new URL(origin).hostname, rpName: 'LinkSim probe', origin,
        schema: { passkey: { modelName: 'probe_passkey' } } }),
      captcha({ provider: 'cloudflare-turnstile',
        // Cloudflare's published always-pass TEST secret; never a production key.
        secretKey: '1x0000000000000000000000000000000AA',
        endpoints: ['/sign-in/social'],
      }),
    ],
  };
}

export function createProbe(env) {
  return betterAuth(probeOptions(env));
}
