import { encodeHistoryDetails } from '../../functions/_lib/historyDetails';
import { LIBRARY_REQUEST_MAX_BYTES, validateLibraryPayload } from '../../src/lib/libraryLimits';

type ProbeEnv = { PROBE_ENABLED?: string; PROBE_KEY?: string; PROBE_EXPIRES_AT?: string };
let firstInvocation = true;
export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    const expires = Date.parse(env.PROBE_EXPIRES_AT ?? '');
    if (env.PROBE_ENABLED !== 'history-runtime-only' || !env.PROBE_KEY || !Number.isFinite(expires) ||
        expires <= Date.now() || request.headers.get('authorization') !== `Bearer ${env.PROBE_KEY}`) {
      return new Response(null, { status: 404 });
    }
    const path = new URL(request.url).pathname;
    if (request.method !== 'POST' || !['/probe/baseline', '/probe/compress'].includes(path)) return new Response(null, { status: 404 });
    const first = firstInvocation; firstInvocation = false;
    if (first) console.info(JSON.stringify({ event: 'probe-gateway-first-invocation' }));
    // Bound input before JSON parsing even when Content-Length is absent.
    if (!request.body) return new Response(null, { status: 400 });
    const reader = request.body.getReader();
    let inputBytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      inputBytes += value.length;
      if (inputBytes > LIBRARY_REQUEST_MAX_BYTES) { await reader.cancel(); return new Response(null, { status: 413 }); }
      chunks.push(value);
    }
    let payload;
    try {
      payload = validateLibraryPayload(JSON.parse(await new Blob(chunks).text()));
    } catch { return new Response(null, { status: 422 }); }
    let rawBytes = 0; let storedBytes = 0;
    const encoder = new TextEncoder();
    // A component test, not the full API: no auth/SQL/history lookup. Include
    // serialization and changed snapshot copies equally in both variants.
    for (const item of payload.simulationPresets) {
      const after = item.snapshot as Record<string, unknown>;
      const before = { ...after, previousSyntheticRevision: true };
      const raw = JSON.stringify({ changedFields: ['snapshot'], diff: { snapshot: { before, after } } });
      const stored = path === '/probe/compress' ? await encodeHistoryDetails(raw) : raw;
      rawBytes += encoder.encode(raw).length;
      storedBytes += encoder.encode(stored).length;
    }
    return Response.json({ firstInvocation: first, records: payload.simulationPresets.length, inputBytes, rawBytes, storedBytes }, { headers: { 'cache-control': 'no-store' } });
  },
};
