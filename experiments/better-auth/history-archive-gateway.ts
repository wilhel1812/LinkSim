type GatewayEnv = {
  PROBE_ENABLED?: string;
  PROBE_KEY?: string;
  PROBE_EXPIRES_AT?: string;
  ARCHIVE: DurableObjectNamespace;
};

const routes = new Set(['/archive', '/hydrate', '/restore', '/cleanup']);

export default {
  async fetch(request: Request, env: GatewayEnv): Promise<Response> {
    const expiresAt = Date.parse(env.PROBE_EXPIRES_AT ?? '');
    const url = new URL(request.url);
    if (env.PROBE_ENABLED !== 'synthetic-history-r2' || !env.PROBE_KEY ||
        !Number.isFinite(expiresAt) || expiresAt <= Date.now() ||
        request.method !== 'POST' || !routes.has(url.pathname) ||
        request.headers.get('authorization') !== `Bearer ${env.PROBE_KEY}`) {
      return new Response(null, { status: 404 });
    }
    const forwarded = new Request(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.PROBE_KEY}` },
    });
    const started = Date.now();
    try {
      const response = await env.ARCHIVE.getByName('archive').fetch(forwarded);
      const headers = new Headers(response.headers);
      headers.set('x-probe-object-elapsed-ms', String(Date.now() - started));
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return Response.json({ error: 'Synthetic archive runtime unavailable' }, { status: 503 });
    }
  },
};
