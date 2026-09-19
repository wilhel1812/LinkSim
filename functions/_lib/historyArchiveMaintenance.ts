import { archiveHistoryPage, type ArchiveEnv } from './historyArchive';
import { meterArchiveBindings } from './historyArchiveMetrics';

export const HISTORY_ARCHIVE_MAINTENANCE_LIMITS = Object.freeze({
  attemptedObjectsPerDay: 1_000, archiveBytesPerDay: 100_000_000, lifetimeArchiveBytes: 5_000_000_000,
  scannedRowsPerRun: 25_000, d1RowsReadPerRun: 50_000, d1RowsWrittenPerRun: 7_500, pageSize: 10,
});
export const HISTORY_ARCHIVE_MAINTENANCE_MINIMUM_D1 = Object.freeze({ rowsRead: 64, rowsWritten: 3 });
type Limits = typeof HISTORY_ARCHIVE_MAINTENANCE_LIMITS;
type Options = { enabled?:boolean;runId:string;afterId?:number;limits?:Partial<Limits> };
type Totals = { scannedRows:number;candidateRows:number;attemptedObjects:number;convertedRows:number;archiveBytes:number;nextAfterId:number };
type Reservations = { scannedRows:number;rowsRead:number;rowsWritten:number;r2Puts:number;r2Gets:number };

const columns = {
  resource_changes: ['id','resource_kind','resource_id','action','actor_user_id','changed_at','note','details_json','snapshot_json','archive_key','archive_digest'],
  history_archive_maintenance_budget: ['singleton','utc_day','daily_attempted_objects','daily_archive_bytes','lifetime_archive_bytes','active_run_id','active_run_token','lease_expires_at','setup_run_id','setup_d1_rows_read','setup_d1_rows_written','updated_at'],
  history_archive_maintenance_runs: ['run_id','status','started_at','checkpoint_at','next_after_id','scanned_rows','candidate_rows','attempted_objects','converted_rows','archive_bytes','d1_queries','d1_rows_read','d1_rows_written','r2_puts','r2_gets','reserved_scanned_rows','reserved_d1_rows_read','reserved_d1_rows_written','reserved_r2_puts','reserved_r2_gets','failure_code'],
};
const assertLimits = (requested:Partial<Limits>={}) => {
  const limits={...HISTORY_ARCHIVE_MAINTENANCE_LIMITS,...requested};
  for(const [name,hard] of Object.entries(HISTORY_ARCHIVE_MAINTENANCE_LIMITS)){
    const value=limits[name as keyof Limits];
    if(!Number.isSafeInteger(value)||value<1||value>hard)throw Error(`Invalid history archive maintenance limit: ${name}`);
  }
  if(limits.d1RowsReadPerRun<HISTORY_ARCHIVE_MAINTENANCE_MINIMUM_D1.rowsRead||
    limits.d1RowsWrittenPerRun<HISTORY_ARCHIVE_MAINTENANCE_MINIMUM_D1.rowsWritten)
    throw Error('Invalid history archive maintenance limit: below unavoidable D1 setup cost');
  return limits;
};
const codeFor = (error:unknown) => {
  const text=error instanceof Error?error.message:'';
  if(/budget|limit|cap/i.test(text))return 'budget';
  if(/schema|column|table/i.test(text))return 'schema';
  if(/conflict|lease|token/i.test(text))return 'conflict';
  if(/archive|integrity|object|R2/i.test(text))return 'archive';
  if(/metric/i.test(text))return 'metrics';
  return 'runtime';
};
const clock=()=>{const now=new Date();const timestamp=now.toISOString();return {timestamp,utcDay:timestamp.slice(0,10)};};

export async function runHistoryArchiveMaintenance(env:ArchiveEnv,options:Options) {
  const limits=assertLimits(options.limits);
  if(options.enabled!==true)return {status:'disabled' as const};
  if(!/^[1-9][0-9]{0,19}(?:-[1-9][0-9]{0,4})?$/.test(options.runId))throw Error('Invalid history archive maintenance run ID');
  const afterId=options.afterId??0;
  if(!Number.isSafeInteger(afterId)||afterId<0)throw Error('Invalid history archive maintenance checkpoint');
  const acquisitionToken=crypto.randomUUID();
  const {DB,BUCKET,metrics}=meterArchiveBindings(env.DB,env.BUCKET);
  const archive={DB,BUCKET,scope:env.scope};
  const totals:Totals={scannedRows:0,candidateRows:0,attemptedObjects:0,convertedRows:0,archiveBytes:0,nextAfterId:afterId};
  const reserved:Reservations={scannedRows:0,rowsRead:0,rowsWritten:0,r2Puts:0,r2Gets:0};
  const prior={queries:0,rowsRead:0,rowsWritten:0,r2Puts:0,r2Gets:0};
  let runStarted=false,lockHeld=false;
  const combined=()=>({queries:prior.queries+metrics.queries,rowsRead:prior.rowsRead+metrics.rowsRead,
    rowsWritten:prior.rowsWritten+metrics.rowsWritten,r2Puts:prior.r2Puts+metrics.r2Puts,r2Gets:prior.r2Gets+metrics.r2Gets});
  const assertMeasuredCaps=(reserveWrites=0,reserveReads=0)=>{
    const used=combined();
    if(used.rowsRead+reserveReads>limits.d1RowsReadPerRun||used.rowsWritten+reserveWrites>limits.d1RowsWrittenPerRun||
      used.r2Puts>limits.attemptedObjectsPerDay||used.r2Gets>limits.attemptedObjectsPerDay)
      throw Error('History archive maintenance run cap reached');
  };
  const tokenPredicate=`EXISTS (SELECT 1 FROM history_archive_maintenance_budget b WHERE b.singleton=1
    AND b.active_run_id=? AND b.active_run_token=? AND b.lease_expires_at>?)`;
  const checkpoint=async(status:'running'|'completed'|'failed',failureCode:string|null)=>{
    assertMeasuredCaps(status==='running'?3:2);
    const used=combined(),{timestamp}=clock(),terminalWrites=status==='running'?1:2;
    const saved=await DB.prepare(`UPDATE history_archive_maintenance_runs SET status=?,checkpoint_at=?,next_after_id=?,
      scanned_rows=?,candidate_rows=?,attempted_objects=MAX(attempted_objects,?),converted_rows=?,archive_bytes=MAX(archive_bytes,?),
      d1_queries=?,d1_rows_read=?,d1_rows_written=?,r2_puts=?,r2_gets=?,failure_code=?
      WHERE run_id=? AND status='running' AND ${tokenPredicate}`)
      .bind(status,timestamp,totals.nextAfterId,totals.scannedRows,totals.candidateRows,totals.attemptedObjects,
        totals.convertedRows,totals.archiveBytes,used.queries+terminalWrites,used.rowsRead+terminalWrites,
        used.rowsWritten+terminalWrites,used.r2Puts,used.r2Gets,failureCode,options.runId,
        options.runId,acquisitionToken,timestamp).run();
    if(saved.meta.changes!==1)throw Error('History archive maintenance checkpoint conflict');
  };
  const release=async()=>{
    if(!lockHeld)return;
    assertMeasuredCaps(1);
    const {timestamp}=clock();
    const released=await DB.prepare(`UPDATE history_archive_maintenance_budget SET active_run_id=NULL,active_run_token=NULL,
      lease_expires_at=NULL,updated_at=? WHERE singleton=1 AND active_run_id=? AND active_run_token=? AND lease_expires_at>?`)
      .bind(timestamp,options.runId,acquisitionToken,timestamp).run();
    if(released.meta.changes!==1)throw Error('History archive maintenance lock conflict');
    lockHeld=false;
  };
  try{
    const acquiredAt=clock(),leaseExpiresAt=new Date(new Date(acquiredAt.timestamp).getTime()+30*60_000).toISOString();
    const acquired=await DB.prepare(`UPDATE history_archive_maintenance_budget SET
      active_run_id=?,active_run_token=?,lease_expires_at=?,setup_run_id=?,
      setup_d1_rows_read=(CASE WHEN setup_run_id=? THEN setup_d1_rows_read ELSE 0 END)+?,
      setup_d1_rows_written=(CASE WHEN setup_run_id=? THEN setup_d1_rows_written ELSE 0 END)+?,updated_at=?
      WHERE singleton=1 AND (active_run_id IS NULL OR
        (active_run_id=? AND (lease_expires_at IS NULL OR lease_expires_at<=?)))
        AND (CASE WHEN setup_run_id=? THEN setup_d1_rows_read ELSE 0 END)+?
          +COALESCE((SELECT reserved_d1_rows_read FROM history_archive_maintenance_runs WHERE run_id=?),0)<=?
        AND (CASE WHEN setup_run_id=? THEN setup_d1_rows_written ELSE 0 END)+?
          +COALESCE((SELECT reserved_d1_rows_written FROM history_archive_maintenance_runs WHERE run_id=?),0)<=?`)
      .bind(options.runId,acquisitionToken,leaseExpiresAt,options.runId,options.runId,
        HISTORY_ARCHIVE_MAINTENANCE_MINIMUM_D1.rowsRead,options.runId,HISTORY_ARCHIVE_MAINTENANCE_MINIMUM_D1.rowsWritten,
        acquiredAt.timestamp,options.runId,acquiredAt.timestamp,options.runId,HISTORY_ARCHIVE_MAINTENANCE_MINIMUM_D1.rowsRead,
        options.runId,limits.d1RowsReadPerRun,options.runId,HISTORY_ARCHIVE_MAINTENANCE_MINIMUM_D1.rowsWritten,
        options.runId,limits.d1RowsWrittenPerRun).run();
    if(acquired.meta.changes!==1)throw Error('History archive maintenance setup reservation cap or conflict');
    lockHeld=true;
    for(const [table,expected] of Object.entries(columns)){
      const found=await DB.prepare(`PRAGMA table_info(${table})`).all<{name:string}>();
      const names=new Set(found.results.map(row=>row.name));
      if(expected.some(name=>!names.has(name)))throw Error(`Missing history archive maintenance schema: ${table}`);
    }
    const existing=await DB.prepare(`SELECT status,next_after_id,scanned_rows,candidate_rows,attempted_objects,converted_rows,
      archive_bytes,d1_queries,d1_rows_read,d1_rows_written,r2_puts,r2_gets,reserved_scanned_rows,reserved_d1_rows_read,
      reserved_d1_rows_written,reserved_r2_puts,reserved_r2_gets FROM history_archive_maintenance_runs WHERE run_id=?`)
      .bind(options.runId).first<Record<string,number|string>>();
    if(existing){
      if(existing.status!=='running')throw Error('History archive maintenance run is not resumable');
      Object.assign(totals,{nextAfterId:Number(existing.next_after_id),scannedRows:Number(existing.scanned_rows),
        candidateRows:Number(existing.candidate_rows),attemptedObjects:Number(existing.attempted_objects),
        convertedRows:Number(existing.converted_rows),archiveBytes:Number(existing.archive_bytes)});
      Object.assign(prior,{queries:Number(existing.d1_queries),rowsRead:Number(existing.d1_rows_read),
        rowsWritten:Number(existing.d1_rows_written),r2Puts:Number(existing.r2_puts),r2Gets:Number(existing.r2_gets)});
      Object.assign(reserved,{scannedRows:Number(existing.reserved_scanned_rows),rowsRead:Number(existing.reserved_d1_rows_read),
        rowsWritten:Number(existing.reserved_d1_rows_written),r2Puts:Number(existing.reserved_r2_puts),r2Gets:Number(existing.reserved_r2_gets)});
    }else{
      const started=await DB.prepare(`INSERT INTO history_archive_maintenance_runs
        (run_id,status,started_at,checkpoint_at,next_after_id) VALUES(?,'running',?,?,?)`)
        .bind(options.runId,acquiredAt.timestamp,acquiredAt.timestamp,afterId).run();
      if(started.meta.changes!==1)throw Error('History archive maintenance run did not start');
    }
    runStarted=true;
    while(reserved.scannedRows<limits.scannedRowsPerRun){
      const limit=Math.min(limits.pageSize,limits.scannedRowsPerRun-reserved.scannedRows);
      assertMeasuredCaps(2,limit);
      const scanAt=clock();
      const scanReservation=await DB.prepare(`UPDATE history_archive_maintenance_runs SET
        reserved_scanned_rows=reserved_scanned_rows+?,reserved_d1_rows_read=reserved_d1_rows_read+?,
        reserved_d1_rows_written=reserved_d1_rows_written+2
        WHERE run_id=? AND status='running' AND reserved_scanned_rows+?<=?
          AND reserved_d1_rows_read+?+(SELECT setup_d1_rows_read FROM history_archive_maintenance_budget WHERE singleton=1)<=?
          AND reserved_d1_rows_written+2+(SELECT setup_d1_rows_written FROM history_archive_maintenance_budget WHERE singleton=1)<=?
          AND ${tokenPredicate}`)
        .bind(limit,limit,options.runId,limit,limits.scannedRowsPerRun,limit,limits.d1RowsReadPerRun,
          limits.d1RowsWrittenPerRun,options.runId,acquisitionToken,scanAt.timestamp).run();
      if(scanReservation.meta.changes!==1)throw Error('History archive maintenance scan reservation cap or conflict');
      reserved.scannedRows+=limit;reserved.rowsRead+=limit;reserved.rowsWritten+=2;
      const page=await archiveHistoryPage(archive,{afterId:totals.nextAfterId,limit,apply:true,stopOnConflict:true,
        beforeApply:async candidate=>{
          assertMeasuredCaps(6,1);
          const candidateAt=clock();
          const runReservation=await DB.prepare(`UPDATE history_archive_maintenance_runs SET
            attempted_objects=attempted_objects+1,archive_bytes=archive_bytes+?,reserved_d1_rows_read=reserved_d1_rows_read+1,
            reserved_d1_rows_written=reserved_d1_rows_written+5,reserved_r2_puts=reserved_r2_puts+1,reserved_r2_gets=reserved_r2_gets+1
            WHERE run_id=? AND status='running'
              AND reserved_d1_rows_read+1+(SELECT setup_d1_rows_read FROM history_archive_maintenance_budget WHERE singleton=1)<=?
              AND reserved_d1_rows_written+5+(SELECT setup_d1_rows_written FROM history_archive_maintenance_budget WHERE singleton=1)<=?
              AND reserved_r2_puts+1<=? AND reserved_r2_gets+1<=? AND ${tokenPredicate}`)
            .bind(candidate.archiveBytes,options.runId,limits.d1RowsReadPerRun,limits.d1RowsWrittenPerRun,
              limits.attemptedObjectsPerDay,limits.attemptedObjectsPerDay,options.runId,acquisitionToken,candidateAt.timestamp).run();
          if(runReservation.meta.changes!==1)throw Error('History archive maintenance candidate reservation cap or conflict');
          reserved.rowsRead++;reserved.rowsWritten+=5;reserved.r2Puts++;reserved.r2Gets++;
          const budgetReservation=await DB.prepare(`UPDATE history_archive_maintenance_budget SET
            utc_day=?,daily_attempted_objects=CASE WHEN utc_day=? THEN daily_attempted_objects+1 ELSE 1 END,
            daily_archive_bytes=CASE WHEN utc_day=? THEN daily_archive_bytes+? ELSE ? END,
            lifetime_archive_bytes=lifetime_archive_bytes+?,updated_at=?
            WHERE singleton=1 AND active_run_id=? AND active_run_token=? AND lease_expires_at>? AND utc_day<=?
              AND lifetime_archive_bytes+?<=?
              AND (CASE WHEN utc_day=? THEN daily_attempted_objects ELSE 0 END)+1<=?
              AND (CASE WHEN utc_day=? THEN daily_archive_bytes ELSE 0 END)+?<=?`)
            .bind(candidateAt.utcDay,candidateAt.utcDay,candidateAt.utcDay,candidate.archiveBytes,candidate.archiveBytes,
              candidate.archiveBytes,candidateAt.timestamp,options.runId,acquisitionToken,candidateAt.timestamp,candidateAt.utcDay,
              candidate.archiveBytes,limits.lifetimeArchiveBytes,candidateAt.utcDay,limits.attemptedObjectsPerDay,
              candidateAt.utcDay,candidate.archiveBytes,limits.archiveBytesPerDay).run();
          if(budgetReservation.meta.changes!==1)throw Error('History archive maintenance budget exhausted');
          totals.attemptedObjects++;totals.archiveBytes+=candidate.archiveBytes;
        }});
      totals.scannedRows+=page.scanned;totals.candidateRows+=page.candidates;totals.convertedRows+=page.converted;
      totals.nextAfterId=page.nextId;
      await checkpoint(page.scanned===0?'completed':'running',null);
      if(page.scanned===0){await release();return {status:'completed' as const,...totals,metrics:combined()};}
    }
    await checkpoint('completed',null);
    await release();
    return {status:'completed' as const,...totals,metrics:combined()};
  }catch(error){
    if(runStarted){try{await checkpoint('failed',codeFor(error));}catch{/* Preserve original error. */}}
    try{await release();}catch{/* Preserve original error. */}
    throw error;
  }
}
