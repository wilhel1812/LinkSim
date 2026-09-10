import { AsyncLocalStorage } from 'node:async_hooks';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, freshSessionMiddleware } from 'better-auth/api';
import { probeOptions } from './probe.mjs';

import { routes, securityHeaders, enabled, isBenchmark } from './live-policy.mjs';

export function liveOptions(env) {
  const options = probeOptions(env);
  return {
    ...options,
    appName: 'LinkSim temporary GitHub/passkey validation',
    logger: { disabled: true },
    account: { ...options.account, encryptOAuthTokens: true, accountLinking: { enabled: false } },
    socialProviders: { github: {
      clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET,
      mapProfileToUser(profile) {
        if (!env.PROBE_GITHUB_ID || String(profile.id) !== env.PROBE_GITHUB_ID) {
          throw new APIError('FORBIDDEN', { message: 'This GitHub identity is not enabled for the temporary test' });
        }
        return {};
      },
    } },
    hooks: { before: createAuthMiddleware(async ctx => {
      if (ctx.path === '/passkey/delete-passkey') await freshSessionMiddleware(ctx);
    }) },
  };
}

export function createLiveWorker({ page, script }, makeAuth = betterAuth) {
  const requests = new AsyncLocalStorage();
  const instances = new WeakMap();
  function instrument(db) {
    function statement(stmt) {
      return new Proxy(stmt, { get(target, property) {
        if (property === 'bind') return (...values) => statement(target.bind(...values));
        if (property === 'all' || property === 'run') return (...args) => {
          const record = result => {
            const metrics = requests.getStore();
            if (metrics) {
              metrics.queries++;
              metrics.rowsRead += result?.meta?.rows_read ?? 0;
              metrics.rowsWritten += result?.meta?.rows_written ?? 0;
            }
            return result;
          };
          const result = target[property](...args);
          return result?.then ? result.then(record) : record(result);
        };
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    }
    return new Proxy(db, { get(target, property) {
      if (property === 'prepare') return sql => statement(target.prepare(sql));
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  }
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (!enabled(request, env) || !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.BETTER_AUTH_SECRET) {
        return new Response(null, { status: 404 });
      }
      const headers = securityHeaders;
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/client.js')) {
        return new Response(url.pathname === '/' ? page : script, { headers: { ...headers,
          'content-type': url.pathname === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' } });
      }
      const benchmark = isBenchmark(request);
      if (!benchmark && routes.get(url.pathname) !== request.method) return new Response(null, { status: 404, headers });
      if (request.method !== 'GET' && request.headers.get('origin') !== env.PROBE_ORIGIN) {
        return new Response(null, { status: 403, headers });
      }
      const metrics = { queries: 0, rowsRead: 0, rowsWritten: 0, initialized: false };
      return requests.run(metrics, async () => {
        let response;
        try {
          const fresh = url.pathname === '/probe/session/fresh';
          let auth = fresh ? undefined : instances.get(env);
          if (!auth) {
            auth = makeAuth(liveOptions({ ...env, DB: instrument(env.DB) }));
            metrics.initialized = true;
            // Better Auth starts schema validation in the background. Workers
            // can discard that I/O when its originating request ends. Complete
            // it within this request before either replying or sharing auth.
            const context = await auth.$context;
            await context.checkSchema?.();
            if (!fresh && !request.signal.aborted) instances.set(env, auth);
          }
          if (benchmark) {
            const session = await auth.api.getSession({ headers: request.headers, returnHeaders: true });
            response = Response.json(session.response ? {
              authenticated: true, emailVerified: session.response.user.emailVerified,
            } : { authenticated: false }, { status: session.response ? 200 : 401, headers: session.headers });
          } else response = await auth.handler(request);
        } catch {
          response = Response.json({ error: 'Validation request failed' }, { status: 500 });
        }
        const result = new Response(response.body, response);
        for (const [key, value] of Object.entries(headers)) result.headers.set(key, value);
        result.headers.set('x-probe-d1', JSON.stringify(metrics));
        // No query strings (OAuth codes), cookies, profiles, tokens or error objects.
        console.info(JSON.stringify({ event: 'auth-validation', path: url.pathname, status: result.status, ...metrics }));
        return result;
      });
    },
  };
}
