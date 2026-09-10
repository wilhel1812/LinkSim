import { routes, securityHeaders, enabled, isBenchmark } from './live-policy.mjs';

// The gateway imports no auth framework, database adapter or provider credentials.
export function createGateway({ page, script }) {
  return { async fetch(request, env) {
    if (!enabled(request, env)) return new Response(null, {status:404});
    const url = new URL(request.url);
    if (request.method === 'GET' && ['/', '/client.js'].includes(url.pathname)) {
      return new Response(url.pathname === '/' ? page : script, {headers:{...securityHeaders,
        'content-type':url.pathname === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8'}});
    }
    const benchmark = isBenchmark(request);
    if (!benchmark && routes.get(url.pathname) !== request.method) return new Response(null,{status:404,headers:securityHeaders});
    if (request.method !== 'GET' && request.headers.get('origin') !== env.PROBE_ORIGIN)
      return new Response(null,{status:403,headers:securityHeaders});
    const headers = new Headers();
    // CF supplies the client IP at this public edge. Never accept user identity or
    // alternative forwarding headers as authority inside the private object.
    for (const name of ['cookie','origin','content-type','accept','user-agent','cf-connecting-ip','x-captcha-response']) {
      const value = request.headers.get(name); if (value !== null) headers.set(name,value);
    }
    const forwarded = new Request(request,{headers});
    const started = Date.now();
    try {
      const stub = env.AUTH.getByName('auth');
      const response = benchmark
        ? await stub.checkSession(forwarded,url.pathname.endsWith('/fresh'))
        : await stub.fetch(forwarded);
      const result = new Response(response.body,response);
      result.headers.set('x-probe-object-elapsed-ms',String(Date.now()-started));
      for(const [name,value] of Object.entries(securityHeaders)) result.headers.set(name,value);
      return result;
    } catch {
      return Response.json({error:'Validation runtime unavailable'},{status:503,headers:securityHeaders});
    }
  }};
}
