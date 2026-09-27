import { DurableObject } from 'cloudflare:workers';
import { handleArchiveProbe } from './history-archive-worker';

// Disposable synthetic runtime. Its D1 and R2 bindings are never present on
// the public gateway; no application route or scheduler invokes this class.
export class HistoryArchiveProbe extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    return handleArchiveProbe(request, this.env);
  }
}

export default { fetch: () => new Response(null, { status: 404 }) };
