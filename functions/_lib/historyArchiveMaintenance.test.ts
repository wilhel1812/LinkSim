import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_ARCHIVE_MAINTENANCE_MINIMUM_D1, runHistoryArchiveMaintenance } from './historyArchiveMaintenance';

const migration = `ALTER TABLE resource_changes ADD COLUMN archive_key TEXT;
ALTER TABLE resource_changes ADD COLUMN archive_digest TEXT;\n` +
  readFileSync('db/migrations/2026-09-19_history_archive_maintenance.sql', 'utf8');

class MeasuredD1 {
  beforeAll?: (sql: string) => void | Promise<void>;
  afterAll?: (sql: string) => void | Promise<void>;
  afterRun?: (sql: string) => void | Promise<void>;
  constructor(readonly db: DatabaseSync) {}
  prepare(sql: string) {
    let values: unknown[] = [];
    return {
      bind(...next: unknown[]) { values = next; return this; },
      all: async () => {
        await this.beforeAll?.(sql);
        const results = this.db.prepare(sql).all(...values as never[]);
        await this.afterAll?.(sql);
        return { results, meta: { rows_read: results.length, rows_written: 0, changes: 0 } };
      },
      run: async () => {
        const result = this.db.prepare(sql).run(...values as never[]);
        await this.afterRun?.(sql);
        return { success: true, meta: { rows_read: 0, rows_written: Number(result.changes), changes: Number(result.changes) } };
      },
    };
  }
}

class Bucket {
  objects = new Map<string, string>(); puts = 0; gets = 0;
  afterPut?: () => void | Promise<void>;
  afterGet?: () => void | Promise<void>;
  async put(key: string, value: string) { this.puts++; this.objects.set(key, value); await this.afterPut?.(); }
  async get(key: string) {
    this.gets++; const value = this.objects.get(key);
    await this.afterGet?.();
    return value === undefined ? null : { size: new TextEncoder().encode(value).length, text: async () => value };
  }
}

const fixture = (rows = 2) => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE resource_changes(id INTEGER PRIMARY KEY, resource_kind TEXT, resource_id TEXT,
    action TEXT, actor_user_id TEXT, changed_at TEXT, note TEXT, snapshot_json TEXT, details_json TEXT);${migration}`);
  const insert = db.prepare(`INSERT INTO resource_changes
    (id,resource_kind,resource_id,action,actor_user_id,changed_at,snapshot_json,details_json)
    VALUES(?, 'simulation', ?, 'updated', 'synthetic', '2026-09-19', ?, '{}')`);
  for (let id = 1; id <= rows; id++) insert.run(id, `sim-${id}`,
    JSON.stringify({ ownerUserId: 'synthetic', visibility: 'private', snapshot: { padding: 'x'.repeat(3000) } }));
  const bucket = new Bucket();
  const measured = new MeasuredD1(db);
  return { db, bucket, measured, env: { DB: measured as unknown as D1Database,
    BUCKET: bucket as unknown as R2Bucket, scope: 'synthetic-staging' } };
};

describe('bounded history archive maintenance', () => {
  afterEach(() => vi.useRealTimers());

  it('is disabled by default without touching bindings', async () => {
    const result = await runHistoryArchiveMaintenance({
      get DB() { throw Error('DB touched'); }, get BUCKET() { throw Error('bucket touched'); }, scope: 'production',
    } as never, { runId: 'disabled' });
    expect(result).toEqual({ status: 'disabled' });
  });

  it('rejects limits below unavoidable setup costs before touching bindings', async () => {
    const env={
      get DB(){throw Error('DB touched');},get BUCKET(){throw Error('bucket touched');},scope:'synthetic-staging',
    } as never;
    await expect(runHistoryArchiveMaintenance(env,{enabled:true,runId:'1000',
      limits:{d1RowsReadPerRun:HISTORY_ARCHIVE_MAINTENANCE_MINIMUM_D1.rowsRead-1}})).rejects.toThrow(/setup cost/i);
    await expect(runHistoryArchiveMaintenance(env,{enabled:true,runId:'1000',
      limits:{d1RowsWrittenPerRun:HISTORY_ARCHIVE_MAINTENANCE_MINIMUM_D1.rowsWritten-1}})).rejects.toThrow(/setup cost/i);
  });

  it('archives through the shared primitive and records a payload-free checkpoint', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
    const f = fixture();
    const result = await runHistoryArchiveMaintenance(f.env, {
      enabled: true, runId: '1001-1',
    });
    expect(result.status).toBe('completed');
    expect(result.convertedRows).toBe(2);
    expect(f.bucket.puts).toBe(2);
    expect(f.db.prepare('SELECT daily_attempted_objects,daily_archive_bytes,lifetime_archive_bytes FROM history_archive_maintenance_budget').get())
      .toMatchObject({ daily_attempted_objects: 2 });
    const checkpoint = f.db.prepare('SELECT * FROM history_archive_maintenance_runs WHERE run_id=?').get('1001-1') as Record<string, unknown>;
    expect(checkpoint).toMatchObject({ status: 'completed', next_after_id: 2, scanned_rows: 2,
      attempted_objects: 2, converted_rows: 2, failure_code: null });
    expect(JSON.stringify(checkpoint)).not.toContain('sim-1');
    f.db.close();
  });

  it('reserves day and lifetime bytes before R2 and fails closed at exact caps', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
    for (const budget of [
      { daily_attempted_objects: 1, daily_archive_bytes: 0, lifetime_archive_bytes: 0 },
      { daily_attempted_objects: 0, daily_archive_bytes: 9_999, lifetime_archive_bytes: 0 },
      { daily_attempted_objects: 0, daily_archive_bytes: 0, lifetime_archive_bytes: 19_999 },
    ]) {
      const f = fixture(1);
      f.db.prepare(`UPDATE history_archive_maintenance_budget SET utc_day='2026-09-19',
        daily_attempted_objects=?,daily_archive_bytes=?,lifetime_archive_bytes=? WHERE singleton=1`)
        .run(budget.daily_attempted_objects, budget.daily_archive_bytes, budget.lifetime_archive_bytes);
      await expect(runHistoryArchiveMaintenance(f.env, {
        enabled: true, runId: `${1000+budget.daily_attempted_objects+budget.daily_archive_bytes+budget.lifetime_archive_bytes}`,
        limits: { attemptedObjectsPerDay: 1, archiveBytesPerDay: 10_000, lifetimeArchiveBytes: 20_000 },
      })).rejects.toThrow(/budget/i);
      expect(f.bucket.puts).toBe(0);
      expect(f.db.prepare('SELECT archive_key FROM resource_changes WHERE id=1').get()).toEqual({ archive_key: null });
      expect(f.db.prepare('SELECT status,failure_code FROM history_archive_maintenance_runs').get())
        .toEqual({ status: 'failed', failure_code: 'budget' });
      f.db.close();
    }
  });

  it('checkpoints a bounded scan so a later run can resume', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
    const f=fixture(2);
    const first=await runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'2001',
      limits:{pageSize:1,scannedRowsPerRun:1}});
    expect(first).toMatchObject({status:'completed',scannedRows:1,convertedRows:1,nextAfterId:1});
    const second=await runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'2002',afterId:first.nextAfterId,
      limits:{pageSize:1,scannedRowsPerRun:1}});
    expect(second).toMatchObject({status:'completed',scannedRows:1,convertedRows:1,nextAfterId:2});
    expect(f.bucket.puts).toBe(2);f.db.close();
  });

  it('resumes an interrupted checkpoint after its persistent lease expires', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T11:00:00Z'));
    const f=fixture(2);f.db.prepare('DELETE FROM resource_changes WHERE id=1').run();
    f.db.prepare(`INSERT INTO history_archive_maintenance_runs
      (run_id,status,started_at,checkpoint_at,next_after_id) VALUES('4001','running','2026-09-19T10:00:00Z','2026-09-19T10:01:00Z',1)`).run();
    f.db.prepare(`UPDATE history_archive_maintenance_budget SET active_run_id='4001',lease_expires_at='2026-09-19T10:30:00Z'`).run();
    const result=await runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'4001'});
    expect(result).toMatchObject({status:'completed',nextAfterId:2,convertedRows:1});
    expect(f.db.prepare('SELECT active_run_id,lease_expires_at FROM history_archive_maintenance_budget').get())
      .toEqual({active_run_id:null,lease_expires_at:null});
    f.db.close();
  });

  it('retains setup allowance across repeated interruption immediately after lease acquisition', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
    const f=fixture(1);let interruptions=0;
    f.measured.afterRun=(sql)=>{
      if(interruptions<2&&/UPDATE history_archive_maintenance_budget SET\s+active_run_id=\?/.test(sql)){
        interruptions++;throw Error('simulated acquisition interruption');
      }
    };
    const limits={d1RowsReadPerRun:HISTORY_ARCHIVE_MAINTENANCE_MINIMUM_D1.rowsRead*2,
      d1RowsWrittenPerRun:HISTORY_ARCHIVE_MAINTENANCE_MINIMUM_D1.rowsWritten*2};
    await expect(runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'4003',limits})).rejects.toThrow(/interruption/i);
    vi.setSystemTime(new Date('2026-09-19T12:31:00Z'));
    await expect(runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'4003',limits})).rejects.toThrow(/interruption/i);
    expect(f.db.prepare(`SELECT setup_run_id,setup_d1_rows_read,setup_d1_rows_written
      FROM history_archive_maintenance_budget`).get()).toEqual({setup_run_id:'4003',
      setup_d1_rows_read:HISTORY_ARCHIVE_MAINTENANCE_MINIMUM_D1.rowsRead*2,
      setup_d1_rows_written:HISTORY_ARCHIVE_MAINTENANCE_MINIMUM_D1.rowsWritten*2});
    vi.setSystemTime(new Date('2026-09-19T13:02:00Z'));
    await expect(runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'4003',limits})).rejects.toThrow(/cap/i);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM history_archive_maintenance_runs WHERE run_id='4003'").get()).toEqual({n:0});
    expect(f.bucket.puts).toBe(0);
    f.db.close();
  });

  it('includes prior page reservations before reacquiring setup allowance', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T13:00:00Z'));
    const f=fixture(1);
    f.db.prepare(`INSERT INTO history_archive_maintenance_runs
      (run_id,status,started_at,checkpoint_at,reserved_d1_rows_read,reserved_d1_rows_written)
      VALUES('4004','running','2026-09-19T10:00:00Z','2026-09-19T10:01:00Z',60,2)`).run();
    f.db.prepare(`UPDATE history_archive_maintenance_budget SET active_run_id='4004',active_run_token='expired',
      lease_expires_at='2026-09-19T12:30:00Z',setup_run_id='4004',setup_d1_rows_read=64,setup_d1_rows_written=3`).run();
    await expect(runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'4004',
      limits:{d1RowsReadPerRun:128,d1RowsWrittenPerRun:8}})).rejects.toThrow(/cap/i);
    expect(f.db.prepare(`SELECT setup_d1_rows_read,setup_d1_rows_written,active_run_token
      FROM history_archive_maintenance_budget`).get()).toEqual({setup_d1_rows_read:64,
      setup_d1_rows_written:3,active_run_token:'expired'});
    expect(f.bucket.puts).toBe(0);f.db.close();
  });

  it('serializes a different run while the persistent lease is active', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
    const f=fixture(1);
    f.db.prepare(`UPDATE history_archive_maintenance_budget SET active_run_id='4999',lease_expires_at='2026-09-19T12:30:00Z'`).run();
    await expect(runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'4002'}))
      .rejects.toThrow(/conflict/i);
    expect(f.bucket.puts).toBe(0);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM history_archive_maintenance_runs WHERE run_id='4002'").get()).toEqual({n:0});
    f.db.close();
  });

  it('requires an expired checkpoint to resume with the same run ID', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T13:00:00Z'));
    const f=fixture(1);
    f.db.prepare(`UPDATE history_archive_maintenance_budget SET active_run_id='4998',active_run_token='expired',
      lease_expires_at='2026-09-19T12:30:00Z',setup_run_id='4998',setup_d1_rows_read=64,setup_d1_rows_written=3`).run();
    await expect(runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'4005'})).rejects.toThrow(/conflict/i);
    expect(f.db.prepare(`SELECT active_run_id,setup_run_id,setup_d1_rows_read,setup_d1_rows_written
      FROM history_archive_maintenance_budget`).get()).toEqual({active_run_id:'4998',setup_run_id:'4998',
      setup_d1_rows_read:64,setup_d1_rows_written:3});
    expect(f.bucket.puts).toBe(0);f.db.close();
  });

  it('resets only UTC-day counters while preserving lifetime bytes', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T00:00:00Z'));
    const f=fixture(1);
    f.db.prepare(`UPDATE history_archive_maintenance_budget SET utc_day='2026-09-18',daily_attempted_objects=1000,
      daily_archive_bytes=100000000,lifetime_archive_bytes=1234`).run();
    await runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'5001'});
    const budget=f.db.prepare(`SELECT utc_day,daily_attempted_objects,daily_archive_bytes,lifetime_archive_bytes
      FROM history_archive_maintenance_budget`).get() as Record<string,number|string>;
    expect(budget.utc_day).toBe('2026-09-19');expect(budget.daily_attempted_objects).toBe(1);
    expect(Number(budget.daily_archive_bytes)).toBeGreaterThan(0);
    expect(budget.lifetime_archive_bytes).toBe(1234+Number(budget.daily_archive_bytes));
    f.db.close();
  });

  it('applies a reduced byte cap to the first reservation after UTC rollover', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T00:00:00Z'));
    const f=fixture(1);
    f.db.prepare(`UPDATE history_archive_maintenance_budget SET utc_day='2026-09-18',daily_archive_bytes=99999999`).run();
    await expect(runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'5002',limits:{archiveBytesPerDay:1}}))
      .rejects.toThrow(/budget/i);
    expect(f.bucket.puts).toBe(0);
    expect(f.db.prepare('SELECT utc_day,daily_archive_bytes FROM history_archive_maintenance_budget').get())
      .toEqual({utc_day:'2026-09-18',daily_archive_bytes:99999999});
    f.db.close();
  });

  it('derives the UTC day for every candidate reservation across midnight', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T23:59:59Z'));
    const f=fixture(2);let crossed=false;
    f.bucket.afterGet=()=>{if(!crossed){crossed=true;vi.setSystemTime(new Date('2026-09-20T00:00:01Z'));}};
    await runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'5003',limits:{pageSize:1}});
    expect(f.db.prepare(`SELECT utc_day,daily_attempted_objects FROM history_archive_maintenance_budget`).get())
      .toEqual({utc_day:'2026-09-20',daily_attempted_objects:1});
    expect(f.bucket.puts).toBe(2);
    f.db.close();
  });

  it('fences an older invocation after a same-run token takeover', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
    const f=fixture(1);let replaced=false;
    f.measured.afterAll=(sql)=>{
      if(!replaced&&/FROM resource_changes WHERE id>/.test(sql)){
        replaced=true;
        f.db.prepare(`UPDATE history_archive_maintenance_budget SET active_run_token='replacement',
          lease_expires_at='2026-09-19T12:30:00.000Z' WHERE active_run_id='7001'`).run();
      }
    };
    await expect(runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'7001'})).rejects.toThrow(/conflict/i);
    expect(f.bucket.puts).toBe(0);
    expect(f.db.prepare('SELECT active_run_id,active_run_token FROM history_archive_maintenance_budget').get())
      .toEqual({active_run_id:'7001',active_run_token:'replacement'});
    expect(f.db.prepare("SELECT status FROM history_archive_maintenance_runs WHERE run_id='7001'").get())
      .toEqual({status:'running'});
    f.db.close();
  });

  it('persists scan reservations before reading a page', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
    const f=fixture(1);let observed:Record<string,number>|undefined;
    f.measured.beforeAll=(sql)=>{
      if(/FROM resource_changes WHERE id>/.test(sql)){
        observed=f.db.prepare(`SELECT reserved_scanned_rows,reserved_d1_rows_read,reserved_d1_rows_written
          FROM history_archive_maintenance_runs WHERE run_id='7002'`).get() as Record<string,number>;
        throw Error('simulated scan interruption');
      }
    };
    await expect(runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'7002'})).rejects.toThrow(/interruption/i);
    expect(observed).toEqual({reserved_scanned_rows:10,reserved_d1_rows_read:10,reserved_d1_rows_written:2});
    expect(f.bucket.puts).toBe(0);
    f.db.close();
  });

  it('persists candidate reservations before an R2 side effect and retains them on interruption', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
    const f=fixture(1);let observed:Record<string,number>|undefined;
    f.bucket.afterPut=()=>{
      observed=f.db.prepare(`SELECT attempted_objects,reserved_d1_rows_written,reserved_r2_puts,reserved_r2_gets
        FROM history_archive_maintenance_runs WHERE run_id='7003'`).get() as Record<string,number>;
      throw Error('simulated interruption after R2 put');
    };
    await expect(runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'7003'})).rejects.toThrow(/interruption/i);
    expect(observed).toEqual({attempted_objects:1,reserved_d1_rows_written:7,reserved_r2_puts:1,reserved_r2_gets:1});
    expect(f.bucket.puts).toBe(1);
    expect(f.db.prepare("SELECT attempted_objects,reserved_r2_puts FROM history_archive_maintenance_runs WHERE run_id='7003'").get())
      .toEqual({attempted_objects:1,reserved_r2_puts:1});
    f.db.close();
  });

  it('uses persisted reservations when resuming after an interrupted side effect', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
    const f=fixture(1);
    f.db.prepare(`INSERT INTO history_archive_maintenance_runs
      (run_id,status,started_at,checkpoint_at,next_after_id,attempted_objects,reserved_r2_puts,reserved_r2_gets)
      VALUES('7004','running','2026-09-19T10:00:00Z','2026-09-19T10:01:00Z',0,1,1,1)`).run();
    f.db.prepare(`UPDATE history_archive_maintenance_budget SET active_run_id='7004',active_run_token='old',
      lease_expires_at='2026-09-19T10:30:00Z'`).run();
    await expect(runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'7004',limits:{attemptedObjectsPerDay:1}}))
      .rejects.toThrow(/cap/i);
    expect(f.bucket.puts).toBe(0);
    expect(f.db.prepare("SELECT attempted_objects,reserved_r2_puts FROM history_archive_maintenance_runs WHERE run_id='7004'").get())
      .toEqual({attempted_objects:1,reserved_r2_puts:1});
    f.db.close();
  });

  it('does not start another candidate when a lowered D1 write cap would be exceeded', async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
    const f=fixture(2);
    await expect(runHistoryArchiveMaintenance(f.env,{enabled:true,runId:'6001',
      limits:{d1RowsWrittenPerRun:11}})).rejects.toThrow(/cap/i);
    expect(f.bucket.puts).toBe(1);
    expect(f.db.prepare('SELECT archive_key FROM resource_changes WHERE id=1').get()).not.toEqual({archive_key:null});
    expect(f.db.prepare('SELECT archive_key FROM resource_changes WHERE id=2').get()).toEqual({archive_key:null});
    expect(f.db.prepare("SELECT status,failure_code FROM history_archive_maintenance_runs WHERE run_id='6001'").get())
      .toEqual({status:'failed',failure_code:'budget'});
    f.db.close();
  });

  it('fails closed on missing schema or billing metadata', async () => {
    const missing=fixture(1);missing.db.exec('DROP TABLE history_archive_maintenance_budget');
    await expect(runHistoryArchiveMaintenance(missing.env,{enabled:true,runId:'3001'})).rejects.toThrow(/schema|table/i);
    expect(missing.bucket.puts).toBe(0);missing.db.close();
    const unmetered=fixture(1);
    const DB={prepare:(sql:string)=>({bind(){return this;},all:async()=>({results:unmetered.db.prepare(sql).all()}),
      run:async()=>({success:true})})};
    await expect(runHistoryArchiveMaintenance({...unmetered.env,DB:DB as never},{enabled:true,runId:'3002'}))
      .rejects.toThrow(/metrics/i);
    expect(unmetered.bucket.puts).toBe(0);unmetered.db.close();
  });

  it('rejects limits above the immutable hard ceilings before touching D1', async () => {
    await expect(runHistoryArchiveMaintenance({} as never, {
      enabled: true, runId: 'oversized', limits: { pageSize: 11 },
    })).rejects.toThrow(/limit/i);
  });
});
