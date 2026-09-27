import { DurableObject } from 'cloudflare:workers';
import { handleStagingArchiveRehearsal, validStagingRehearsalRequest } from './history-archive-staging-rehearsal';

type Env = Parameters<typeof handleStagingArchiveRehearsal>[1] & { ARCHIVE: DurableObjectNamespace };

// Temporary remote-development entrypoint only. No permanent route or schedule.
export class HistoryArchiveStagingRehearsal extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    return handleStagingArchiveRehearsal(request, this.env);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!validStagingRehearsalRequest(request, env)) return new Response(null, { status: 404 });
    const url = new URL(request.url);
    const forwarded = new Request(`https://rehearsal.internal${url.pathname}`, {
      method: 'POST', headers: { authorization: request.headers.get('authorization') ?? '' },
    });
    try {
      return await env.ARCHIVE.getByName('staging-rehearsal').fetch(forwarded);
    } catch {
      return new Response(null, { status: 503 });
    }
  },
};
