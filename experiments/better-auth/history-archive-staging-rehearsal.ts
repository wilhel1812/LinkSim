import { archiveHistoryPage, hydrateHistoryRow, restoreHistoryRow } from './history-archive';
import { meterArchiveBindings } from './history-archive-metrics';

type Env = {
  DB: D1Database;
  HISTORY_BUCKET: R2Bucket;
  HISTORY_SCOPE?: string;
  REHEARSAL_KEY?: string;
  REHEARSAL_EXPIRES_AT?: string;
  REHEARSAL_ROW_ID?: string;
  REHEARSAL_RESOURCE_KIND?: string;
  REHEARSAL_RESOURCE_ID?: string;
  REHEARSAL_ACTOR_USER_ID?: string;
};

const routes = new Set(['/dry-run', '/archive', '/hydrate', '/restore']);
export function validStagingRehearsalRequest(request: Request, env: Env) {
  const url = new URL(request.url);
  const expiry = Date.parse(env.REHEARSAL_EXPIRES_AT ?? '');
  const rowId = env.REHEARSAL_ROW_ID ?? '';
  return env.HISTORY_SCOPE === 'staging' && /^[a-f0-9]{64}$/.test(env.REHEARSAL_KEY ?? '') &&
    request.headers.get('authorization') === `Bearer ${env.REHEARSAL_KEY}` &&
    Number.isFinite(expiry) && expiry > Date.now() && expiry <= Date.now() + 30 * 60_000 &&
    /^[1-9][0-9]*$/.test(rowId) && Number.isSafeInteger(Number(rowId)) &&
    ['site', 'simulation'].includes(env.REHEARSAL_RESOURCE_KIND ?? '') &&
    !!env.REHEARSAL_RESOURCE_ID?.startsWith('archive-rehearsal-') &&
    !!env.REHEARSAL_ACTOR_USER_ID?.startsWith('archive-rehearsal-') &&
    request.method === 'POST' && routes.has(url.pathname) && url.search === '';
}

export async function handleStagingArchiveRehearsal(request: Request, env: Env): Promise<Response> {
  if (!validStagingRehearsalRequest(request, env)) return new Response(null, { status: 404 });
  const id = Number(env.REHEARSAL_ROW_ID);
  const { DB, BUCKET, metrics } = meterArchiveBindings(env.DB, env.HISTORY_BUCKET);
  const row = await DB.prepare('SELECT resource_kind, resource_id, actor_user_id FROM resource_changes WHERE id=?')
    .bind(id).first<{ resource_kind: string; resource_id: string; actor_user_id: string }>();
  if (!row || row.resource_kind !== env.REHEARSAL_RESOURCE_KIND || row.resource_id !== env.REHEARSAL_RESOURCE_ID ||
    row.actor_user_id !== env.REHEARSAL_ACTOR_USER_ID) return new Response(null, { status: 409 });
  const archiveEnv = { DB, BUCKET, scope: 'staging' };
  const path = new URL(request.url).pathname;
  let result: unknown;
  if (path === '/dry-run' || path === '/archive') {
    result = await archiveHistoryPage(archiveEnv, {
      target: { id, resourceKind: row.resource_kind as 'site' | 'simulation', resourceId: row.resource_id, actorUserId: row.actor_user_id },
      apply: path === '/archive',
    });
  } else if (path === '/hydrate') {
    const hydrated = await hydrateHistoryRow(archiveEnv, id, { kind: row.resource_kind as 'site' | 'simulation', id: row.resource_id });
    result = { found: !!hydrated, archived: !!hydrated?.archive_key && !!hydrated?.archive_digest,
      bytes: new TextEncoder().encode((hydrated?.snapshot_json ?? '') + (hydrated?.details_json ?? '')).length };
  } else {
    result = { restored: await restoreHistoryRow(archiveEnv, id,
      { id, resourceKind: row.resource_kind as 'site' | 'simulation', resourceId: row.resource_id, actorUserId: row.actor_user_id }) };
  }
  return Response.json({ result, metrics }, { headers: { 'cache-control': 'no-store' } });
}
