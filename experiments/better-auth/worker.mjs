import { betterAuth } from 'better-auth';
import { testUtils } from 'better-auth/plugins';
import { createProbe, probeOptions } from './probe.mjs';

// This fixture wrapper must never be deployed with application data or real IdPs.
// All requests, including library endpoints, require the disposable probe secret.
export default {
  async fetch(request, env) {
    if (env.GITHUB_CLIENT_SECRET || env.GITLAB_CLIENT_SECRET ||
        env.PROBE_ENABLED !== 'isolated-auth-probe' || !env.PROBE_KEY ||
        request.headers.get('authorization') !== `Bearer ${env.PROBE_KEY}`) {
      return new Response(null, { status: 404 });
    }
    const metrics = { queries: 0, rowsRead: 0, rowsWritten: 0 };
    function statement(stmt) {
      return new Proxy(stmt, { get(target, property) {
        if (property === 'bind') return (...values) => statement(target.bind(...values));
        if (property === 'all' || property === 'run') return async (...args) => {
          const result = await target[property](...args);
          metrics.queries++;
          metrics.rowsRead += result.meta?.rows_read ?? 0;
          metrics.rowsWritten += result.meta?.rows_written ?? 0;
          return result;
        };
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    }
    const DB = new Proxy(env.DB, { get(target, property) {
      if (property === 'prepare') return sql => statement(target.prepare(sql));
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const probeEnv = { ...env, DB };
    const path = new URL(request.url).pathname;
    let response;
    try {
      if (path === '/probe/fixture' && request.method === 'POST') {
        const options = probeOptions(probeEnv);
        const auth = betterAuth({ ...options, plugins: [...options.plugins, testUtils()] });
        const { test } = await auth.$context;
        const user = await test.saveUser(test.createUser());
        const { headers } = await test.login({ userId: user.id });
        response = Response.json({ cookie: headers.get('cookie') });
      } else if (path.startsWith('/api/auth/')) {
        response = await createProbe(probeEnv).handler(request);
      } else {
        response = new Response(null, { status: 404 });
      }
      const result = new Response(response.body, response);
      result.headers.set('cache-control', 'no-store');
      result.headers.set('x-probe-d1', JSON.stringify(metrics));
      return result;
    } finally {
      // Only aggregate costs: never log tokens, cookies, bodies, or user identifiers.
      console.info(JSON.stringify({ event: 'auth-probe', path, ...metrics }));
    }
  },
};
