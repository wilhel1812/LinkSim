// Dormant integration proof only. The caller must already have authenticated
// the actor; this module adds no route, binding or live archive fallback.
import { resolveResourceChangeAccess } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/types';
import { hydrateHistoryRow, type ArchiveEnv } from './history-archive';

type Actor = { id:string; isAdmin:boolean; isModerator:boolean };

export async function readAuthorizedArchivedHistory(
  archive:ArchiveEnv,kind:'site'|'simulation',resourceId:string,changeId:number,actor:Actor,
) {
  if(!Number.isSafeInteger(changeId)||changeId<1 || !resourceId.trim())return {ok:false as const,reason:'missing' as const};
  const env={DB:archive.DB} as Env;
  const access=await resolveResourceChangeAccess(env,kind,resourceId,actor,'revert');
  if(!access.ok)return access;
  const sql='SELECT snapshot_json,details_json,archive_key,archive_digest FROM resource_changes WHERE id=? AND resource_kind=? AND resource_id=?';
  const readRevision=()=>archive.DB.prepare(sql).bind(changeId,kind,resourceId)
    .first<{snapshot_json:string|null;details_json:string|null;archive_key:string|null;archive_digest:string|null}>();
  const before=await readRevision();
  if(!before)return {ok:false as const,reason:'missing' as const};
  // Scope the change ID to the resource before any potentially large R2 read.
  const row=await hydrateHistoryRow(archive,changeId,{kind,id:resourceId});
  if(!row)return {ok:false as const,reason:'missing' as const};
  const after=await readRevision();
  if(!after||Object.keys(before).some(key=>before[key as keyof typeof before]!==after[key as keyof typeof after]))
    throw Error('History changed during hydration');
  // A grant or ownership may change while an R2 read is in flight.
  const current=await resolveResourceChangeAccess(env,kind,resourceId,actor,'revert');
  return current.ok?{ok:true as const,row}:current;
}
