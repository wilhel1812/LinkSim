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
    return this.worker.fetch(new Request(url,{headers:request.headers}),this.env);
  }
}
export default {fetch(){return new Response(null,{status:404});}};
