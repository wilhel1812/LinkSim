import {
  MAX_JOB_ERROR_LENGTH,
  MAX_JOB_RUNTIME_MS,
  MAX_TERMINAL_JOBS,
  TERMINAL_JOB_RETENTION_HOURS,
} from "./calculateShared";
import type { Env } from "./types";

export const JOB_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  TIMED_OUT: "timed_out",
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];
export type JobRow = {
  id: string;
  status: string;
  input_json: string;
  result_json: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

const terminalStatuses = [JOB_STATUS.COMPLETED, JOB_STATUS.FAILED, JOB_STATUS.TIMED_OUT] as const;
const jobRuntimeMinutes = MAX_JOB_RUNTIME_MS / 60_000;

export const boundedJobError = (message: string): string => {
  let result = "";
  let bytes = 0;
  for (const char of message) {
    const charBytes = new TextEncoder().encode(char).byteLength;
    if (bytes + charBytes > MAX_JOB_ERROR_LENGTH) break;
    result += char;
    bytes += charBytes;
  }
  return result;
};

export const ensureCalculationJobsTable = async (env: Env): Promise<void> => {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS calculation_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'queued', input_json TEXT NOT NULL, result_json TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
};

export const getCalculationJob = async (env: Env, jobId: string): Promise<JobRow | null> =>
  env.DB.prepare(
    "SELECT id, status, input_json, result_json, error_message, created_at, updated_at FROM calculation_jobs WHERE id = ?",
  ).bind(jobId).first<JobRow>();

export const createCalculationJob = async (env: Env, jobId: string, inputJson: string): Promise<void> => {
  await env.DB.prepare(
    "INSERT INTO calculation_jobs (id, status, input_json, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
  ).bind(jobId, JOB_STATUS.QUEUED, inputJson).run();
};

export const transitionCalculationJob = async (
  env: Env,
  jobId: string,
  fromStatuses: readonly JobStatus[],
  status: JobStatus,
  resultJson: string | null,
  errorMessage: string | null,
): Promise<boolean> => {
  const placeholders = fromStatuses.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `UPDATE calculation_jobs SET status = ?, result_json = ?, error_message = ?, updated_at = datetime('now') WHERE id = ? AND status IN (${placeholders})`,
  ).bind(status, resultJson, errorMessage === null ? null : boundedJobError(errorMessage), jobId, ...fromStatuses).run();
  return Number(result.meta?.changes ?? 0) > 0;
};

export const finishCalculationJobBeforeDeadline = async (
  env: Env,
  jobId: string,
  status: typeof JOB_STATUS.COMPLETED | typeof JOB_STATUS.FAILED,
  resultJson: string | null,
  errorMessage: string | null,
): Promise<boolean> => {
  const result = await env.DB.prepare(
    `UPDATE calculation_jobs SET status = ?, result_json = ?, error_message = ?, updated_at = datetime('now') WHERE id = ? AND status = ? AND created_at > datetime('now', '-${jobRuntimeMinutes} minutes')`,
  ).bind(
    status,
    resultJson,
    errorMessage === null ? null : boundedJobError(errorMessage),
    jobId,
    JOB_STATUS.RUNNING,
  ).run();
  return Number(result.meta?.changes ?? 0) > 0;
};

export const timeoutCalculationJob = async (env: Env, jobId: string): Promise<boolean> =>
  transitionCalculationJob(env, jobId, [JOB_STATUS.RUNNING], JOB_STATUS.TIMED_OUT, null, "Terrain job timed out.");

export const getAddressedCalculationJob = async (env: Env, jobId: string): Promise<JobRow | null> => {
  await env.DB.prepare(
    `UPDATE calculation_jobs SET status = ?, result_json = NULL, error_message = ?, updated_at = datetime('now') WHERE id = ? AND status IN (?, ?) AND created_at <= datetime('now', '-${jobRuntimeMinutes} minutes')`,
  ).bind(JOB_STATUS.TIMED_OUT, "Terrain job timed out.", jobId, JOB_STATUS.QUEUED, JOB_STATUS.RUNNING).run();
  await env.DB.prepare(
    `DELETE FROM calculation_jobs WHERE id = ? AND status IN (?, ?, ?) AND updated_at <= datetime('now', '-${TERMINAL_JOB_RETENTION_HOURS} hours')`,
  ).bind(jobId, ...terminalStatuses).run();
  return getCalculationJob(env, jobId);
};

export const cleanupCalculationJobs = async (env: Env): Promise<void> => {
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_calculation_jobs_status ON calculation_jobs(status)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_calculation_jobs_created_at ON calculation_jobs(created_at)").run();
  await env.DB.prepare(
    `UPDATE calculation_jobs SET status = ?, result_json = NULL, error_message = ?, updated_at = datetime('now') WHERE status IN (?, ?) AND created_at <= datetime('now', '-${jobRuntimeMinutes} minutes')`,
  ).bind(JOB_STATUS.TIMED_OUT, "Terrain job timed out.", JOB_STATUS.QUEUED, JOB_STATUS.RUNNING).run();
  await env.DB.prepare(
    `DELETE FROM calculation_jobs WHERE status IN (?, ?, ?) AND updated_at <= datetime('now', '-${TERMINAL_JOB_RETENTION_HOURS} hours')`,
  ).bind(...terminalStatuses).run();
  await env.DB.prepare(
    `DELETE FROM calculation_jobs WHERE id IN (
      SELECT id FROM calculation_jobs WHERE status IN (?, ?, ?)
      ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT -1 OFFSET ${MAX_TERMINAL_JOBS}
    )`,
  ).bind(...terminalStatuses).run();
};
