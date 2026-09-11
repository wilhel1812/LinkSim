import { DurableObject } from 'cloudflare:workers';
import { createLiveWorker } from './live.mjs';
import { routes } from './live-policy.mjs';

export class AuthProbe extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.worker = createLiveWorker({page:'',script:''});
  }
  async fetch(request) {
    if(routes.get(new URL(request.url).pathname) !== request.method) return new Response(null,{status:404});
    return this.worker.fetch(request,this.env);
  }
  async checkSession(request,fresh=false) {
    // Only a private binding can invoke this operation. No public internal path.
    const url = new URL(request.url);
    url.pathname = fresh ? '/probe/session/fresh' : '/probe/session/reused';
    url.search = '';
    const response = await this.worker.fetch(new Request(url,{headers:request.headers}),this.env);
    // Finish the bounded session response inside the RPC. Returning a live body
    // stream keeps the RPC context tied to the gateway's response lifetime.
    const body = await response.text();
    const headers = [...response.headers].filter(([name])=>name.toLowerCase()!=='set-cookie');
    for (const cookie of response.headers.getSetCookie()) headers.push(['set-cookie',cookie]);
    return {status:response.status,headers,body};
  }
}
export default {fetch(){return new Response(null,{status:404});}};
