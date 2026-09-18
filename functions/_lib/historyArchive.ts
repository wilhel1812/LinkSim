// Archive storage primitive. Callers must perform current application
// authorization before hydrating history; no route enables writes by default.
const MAX_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
type Row = {id:number; snapshot_json:string|null; details_json:string|null; archive_key:string|null; archive_digest:string|null};
export type ArchiveEnv = {DB:D1Database; BUCKET:R2Bucket; scope:string};
type ArchiveTarget = {id:number;resourceKind:'site'|'simulation';resourceId:string;actorUserId:string};
const columns = 'id, snapshot_json, details_json, archive_key, archive_digest';
const namespace = (scope:string) => {
  if (!/^(synthetic-)?(staging|production)$/.test(scope)) throw Error('Invalid archive scope');
  return `history-prototype/${scope}/`;
};
const hasArchiveReference = (scope:string,row:Row) => {
  if ((row.archive_key === null) !== (row.archive_digest === null)) throw Error('Incomplete archive reference');
  if (row.archive_key === null) return false;
  if (!row.archive_key.startsWith(`${namespace(scope)}${row.id}/`) || !row.archive_digest) throw Error('Invalid archive reference');
  return true;
};
const digest = async (text:string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
const project = (snapshot:string|null, details:string|null) => {
  const s=snapshot===null?null:JSON.parse(snapshot),d=details===null?null:JSON.parse(details);
  if (s!==null&&!object(s) || d!==null&&!object(d)) throw Error('Invalid history shape');
  if (s && 'snapshot' in s) delete s.snapshot;
  if (d && object(d.diff)) delete d.diff.snapshot;
  return {snapshot_json:s===null?null:JSON.stringify(s),details_json:d===null?null:JSON.stringify(d)};
};
const readArchive = async (env:ArchiveEnv,row:Row) => {
  const prefix=namespace(env.scope);
  if (!row.archive_key?.startsWith(`${prefix}${row.id}/`) || !row.archive_digest) throw Error('Invalid archive reference');
  const stored=await env.BUCKET.get(row.archive_key);
  if (!stored || stored.size>MAX_BYTES) throw Error('Archive missing or oversized');
  const raw=await stored.text();
  if (encoder.encode(raw).length>MAX_BYTES || await digest(raw)!==row.archive_digest) throw Error('Archive integrity failure');
  const value=JSON.parse(raw);
  if (value.version!==1 || value.scope!==env.scope || value.id!==row.id ||
      !(value.snapshot_json===null||typeof value.snapshot_json==='string') ||
      !(value.details_json===null||typeof value.details_json==='string')) throw Error('Invalid archive envelope');
  return value as {snapshot_json:string|null;details_json:string|null};
};
const hydrate = async (env:ArchiveEnv,row:Row):Promise<Row> => {
  if (!hasArchiveReference(env.scope,row)) return row;
  const original=await readArchive(env,row);
  const projection=project(original.snapshot_json,original.details_json);
  // Identity reconciliation mutates clear metadata. Reinsert only archived bulky
  // fields; never resurrect old owner/grant metadata from the immutable object.
  const merge=(current:string|null,initial:string|null,raw:string|null,details:boolean) => {
    if(current===initial)return raw; // Exact byte restoration if projection unchanged.
    if(current===null||raw===null)throw Error('Invalid changed projection');
    const value=JSON.parse(current),source=JSON.parse(raw);
    if(!object(value)||!object(source))throw Error('Invalid changed projection');
    if(details){
      if(object(source.diff)&&'snapshot' in source.diff){
        if(!object(value.diff))throw Error('Invalid detail projection');
        value.diff.snapshot=source.diff.snapshot;
      }
    }else if('snapshot' in source)value.snapshot=source.snapshot;
    return JSON.stringify(value);
  };
  return {...row,snapshot_json:merge(row.snapshot_json,projection.snapshot_json,original.snapshot_json,false),
    details_json:merge(row.details_json,projection.details_json,original.details_json,true)};
};
export const hydrateHistoryRow=async(env:ArchiveEnv,id:number,resource?:{kind:'site'|'simulation';id:string}) => {
  namespace(env.scope);
  if(!Number.isSafeInteger(id)||id<1)throw Error('Invalid history id');
  const row=resource
    ? await env.DB.prepare(`SELECT ${columns} FROM resource_changes WHERE id=? AND resource_kind=? AND resource_id=?`).bind(id,resource.kind,resource.id).first<Row>()
    : await env.DB.prepare(`SELECT ${columns} FROM resource_changes WHERE id=?`).bind(id).first<Row>();
  return row?hydrate(env,row):null;
};
export const archiveHistoryPage=async(env:ArchiveEnv,options:{afterId?:number;limit?:number;apply?:boolean;target?:ArchiveTarget}={}) => {
  const target=options.target,afterId=options.afterId??0,limit=target?1:options.limit??10;
  if(!Number.isSafeInteger(afterId)||afterId<0||!Number.isInteger(limit)||limit<1||limit>10)throw Error('Invalid archive page');
  if(target&&(!Number.isSafeInteger(target.id)||target.id<1||!['site','simulation'].includes(target.resourceKind)||
    !target.resourceId||!target.actorUserId||options.afterId!==undefined||options.limit!==undefined))throw Error('Invalid archive target');
  const prefix=namespace(env.scope);
  const rows=target
    ? await env.DB.prepare(`SELECT ${columns} FROM resource_changes WHERE id=? AND resource_kind=? AND resource_id=? AND actor_user_id=?`)
      .bind(target.id,target.resourceKind,target.resourceId,target.actorUserId).all<Row>()
    : await env.DB.prepare(`SELECT ${columns} FROM resource_changes WHERE id>? ORDER BY id LIMIT ?`).bind(afterId,limit).all<Row>();
  const result={scanned:rows.results.length,candidates:0,converted:0,conflicts:0,nextId:target?target.id-1:afterId,bytesBefore:0,bytesAfter:0,archiveBytes:0};
  for(const row of rows.results){
    result.nextId=row.id;if(hasArchiveReference(env.scope,row))continue;
    const projected=project(row.snapshot_json,row.details_json);
    const before=encoder.encode((row.snapshot_json??'')+(row.details_json??'')).length;
    const after=encoder.encode((projected.snapshot_json??'')+(projected.details_json??'')).length;
    // Avoid archiving small/non-bulky rows where reference overhead wins.
    if(before-after<2048)continue;
    const raw=JSON.stringify({version:1,scope:env.scope,id:row.id,snapshot_json:row.snapshot_json,details_json:row.details_json});
    if(encoder.encode(raw).length>MAX_BYTES)throw Error('Archive oversized');
    result.candidates++;result.bytesBefore+=before;result.bytesAfter+=after;result.archiveBytes+=encoder.encode(raw).length;
    if(options.apply!==true)continue;
    const key=`${prefix}${row.id}/${crypto.randomUUID()}`,checksum=await digest(raw);
    // Unique immutable key per attempt. A failed/ambiguous D1 write may have
    // committed: never delete its object in catch/finally or rollback.
    await env.BUCKET.put(key,raw,{httpMetadata:{contentType:'application/json'}});
    const check=await readArchive(env,{...row,archive_key:key,archive_digest:checksum});
    if(check.snapshot_json!==row.snapshot_json||check.details_json!==row.details_json)throw Error('Archive verification failed');
    const identityWhere=target?' AND resource_kind=? AND resource_id=? AND actor_user_id=?':'';
    const saved=await env.DB.prepare(`UPDATE resource_changes SET snapshot_json=?,details_json=?,archive_key=?,archive_digest=? WHERE id=? AND archive_key IS NULL AND snapshot_json IS ? AND details_json IS ?${identityWhere}`)
      .bind(projected.snapshot_json,projected.details_json,key,checksum,row.id,row.snapshot_json,row.details_json,
        ...(target?[target.resourceKind,target.resourceId,target.actorUserId]:[])).run();
    if(saved.meta.changes===1)result.converted++;else result.conflicts++;
  }
  return result;
};
export const restoreHistoryRow=async(env:ArchiveEnv,id:number,target?:ArchiveTarget) => {
  namespace(env.scope);
  if(!Number.isSafeInteger(id)||id<1)throw Error('Invalid history id');
  if(target&&(target.id!==id||!['site','simulation'].includes(target.resourceKind)||!target.resourceId||!target.actorUserId))throw Error('Invalid archive target');
  const identityWhere=target?' AND resource_kind=? AND resource_id=? AND actor_user_id=?':'';
  const identityValues=target?[target.resourceKind,target.resourceId,target.actorUserId]:[];
  const row=await env.DB.prepare(`SELECT ${columns} FROM resource_changes WHERE id=?${identityWhere}`).bind(id,...identityValues).first<Row>();
  if(!row || !hasArchiveReference(env.scope,row))return false;
  const restored=await hydrate(env,row);
  const result=await env.DB.prepare(`UPDATE resource_changes SET snapshot_json=?,details_json=?,archive_key=NULL,archive_digest=NULL WHERE id=? AND archive_key=? AND archive_digest=? AND snapshot_json IS ? AND details_json IS ?${identityWhere}`)
    .bind(restored.snapshot_json,restored.details_json,id,row.archive_key,row.archive_digest,row.snapshot_json,row.details_json,...identityValues).run();
  return result.meta.changes===1;
};

// Synthetic staging-refresh proof. Real production transfer requires a
// separately reviewed sanitizer, physical bucket isolation and import workflow.
export const copyArchivedHistoryRowForStaging=async(source:ArchiveEnv,stagingBucket:R2Bucket,id:number) => {
  if(source.scope!=='synthetic-production')throw Error('Only synthetic production archives can be copied');
  if(!Number.isSafeInteger(id)||id<1)throw Error('Invalid history id');
  const stagingScope='synthetic-staging';
  const row=await source.DB.prepare(`SELECT ${columns} FROM resource_changes WHERE id=?`).bind(id).first<Row>();
  if(!row||!hasArchiveReference(source.scope,row))throw Error('Source history is not archived');
  const hydrated=await hydrate(source,row);
  const projected=project(hydrated.snapshot_json,hydrated.details_json);
  if(projected.snapshot_json!==row.snapshot_json||projected.details_json!==row.details_json)
    throw Error('Source projection differs from verified archive');
  const raw=JSON.stringify({version:1,scope:stagingScope,id,
    snapshot_json:hydrated.snapshot_json,details_json:hydrated.details_json});
  if(encoder.encode(raw).length>MAX_BYTES)throw Error('Staging archive oversized');
  const stagingKey=`${namespace(stagingScope)}${id}/${crypto.randomUUID()}`;
  const stagingDigest=await digest(raw);
  await stagingBucket.put(stagingKey,raw,{httpMetadata:{contentType:'application/json'}});
  const verified=await readArchive({DB:source.DB,BUCKET:stagingBucket,scope:stagingScope},
    {...row,archive_key:stagingKey,archive_digest:stagingDigest});
  if(verified.snapshot_json!==hydrated.snapshot_json||verified.details_json!==hydrated.details_json)
    throw Error('Staging archive verification failed');
  return {id,sourceKey:row.archive_key!,sourceDigest:row.archive_digest!,stagingKey,stagingDigest};
};
