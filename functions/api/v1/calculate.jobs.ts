import { errorResponse, handleOptions, json, withCors } from "../../_lib/http";
import { getClientAddress, takeRateLimitToken } from "../../_lib/rateLimit";
import { analyzeTerrainLink } from "../../_lib/terrainAnalysis";
import {
  estimateSampleCount,
  findEndpointNodes,
  haversineKm,
  MAX_TERRAIN_DISTANCE_KM,
  normalizeCalculationRequest,
  type CalculationRequest,
} from "../../_lib/calculateShared";
import type { Env } from "../../_lib/types";

type Context = {
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
};

const JOB_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  TIMED_OUT: "timed_out",
} as const;

type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

type JobRow = {
  id: string;
  status: string;
  input_json: string;
  result_json: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

const MAX_RUNTIME_MS = 300000;

const parsePerMinuteLimit = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const generateJobId = (): string => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "calc_";
  for (let i = 0; i < 16; i += 1) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

const ensureCalculationJobsTable = async (env: Env): Promise<void> => {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS calculation_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'queued', input_json TEXT NOT NULL, result_json TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_calculation_jobs_status ON calculation_jobs(status)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_calculation_jobs_created_at ON calculation_jobs(created_at)").run();
};

const getJob = async (env: Env, jobId: string): Promise<JobRow | null> => {
  const stmt = env.DB.prepare(
    "SELECT id, status, input_json, result_json, error_message, created_at, updated_at FROM calculation_jobs WHERE id = ?",
  );
  return stmt.bind(jobId).first<JobRow>();
};

const createJob = async (env: Env, jobId: string, inputJson: string): Promise<void> => {
  const stmt = env.DB.prepare(
    "INSERT INTO calculation_jobs (id, status, input_json, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
  );
  await stmt.bind(jobId, JOB_STATUS.QUEUED, inputJson).run();
};

const updateJob = async (
  env: Env,
  jobId: string,
  status: JobStatus,
  resultJson: string | null,
  errorMessage: string | null,
): Promise<void> => {
  const stmt = env.DB.prepare(
    "UPDATE calculation_jobs SET status = ?, result_json = ?, error_message = ?, updated_at = datetime('now') WHERE id = ?",
  );
  await stmt.bind(status, resultJson, errorMessage, jobId).run();
};

const validateTerrainRequest = (payload: CalculationRequest): { distanceKm: number; samples: number } => {
  const { fromNode, toNode } = findEndpointNodes(payload);
  const distanceKm = haversineKm(fromNode, toNode);
  if (distanceKm > MAX_TERRAIN_DISTANCE_KM) {
    throw new Error(
      `Distance ${distanceKm.toFixed(1)} km exceeds maximum of ${MAX_TERRAIN_DISTANCE_KM} km for terrain jobs.`,
    );
  }
  return { distanceKm, samples: estimateSampleCount(distanceKm) };
};

const processTerrainJob = async (env: Env, jobId: string, requestUrl: string): Promise<void> => {
  const startedAt = Date.now();
  try {
    await updateJob(env, jobId, JOB_STATUS.RUNNING, null, null);
    const row = await getJob(env, jobId);
    if (!row) throw new Error("Job not found while processing.");
    const payload = normalizeCalculationRequest(JSON.parse(row.input_json));
    const { fromNode, toNode } = findEndpointNodes(payload);
    const { samples } = validateTerrainRequest(payload);

    const terrain = await analyzeTerrainLink(
      env,
      requestUrl,
      {
        lat: fromNode.lat,
        lon: fromNode.lon,
        name: fromNode.name,
        txPowerDbm: fromNode.tx_power_dbm,
        txGainDbi: fromNode.tx_gain_dbi,
        rxGainDbi: fromNode.rx_gain_dbi,
        cableLossDb: fromNode.cable_loss_db,
        antennaHeightM: fromNode.antenna_height_m ?? 2,
      },
      {
        lat: toNode.lat,
        lon: toNode.lon,
        name: toNode.name,
        txPowerDbm: toNode.tx_power_dbm,
        txGainDbi: toNode.tx_gain_dbi,
        rxGainDbi: toNode.rx_gain_dbi,
        cableLossDb: toNode.cable_loss_db,
        antennaHeightM: toNode.antenna_height_m ?? 2,
      },
      payload.input.frequency_mhz,
      samples,
    );

    const eirpDbm = fromNode.tx_power_dbm + fromNode.tx_gain_dbi - fromNode.cable_loss_db;
    const rxDbm = eirpDbm + toNode.rx_gain_dbi - terrain.totalPathLossDb;
    const verdict = rxDbm >= payload.input.rx_target_dbm ? "PASS" : "FAIL";
    const runtimeMs = Date.now() - startedAt;

    if (runtimeMs > MAX_RUNTIME_MS) {
      await updateJob(env, jobId, JOB_STATUS.TIMED_OUT, null, "Terrain job timed out.");
      return;
    }

    const result = {
      calculation: "link_budget",
      mode: "terrain",
      terrain_used: true,
      terrain_status: "sampled",
      result: {
        from_site: fromNode.name,
        to_site: toNode.name,
        distance_km: terrain.distanceKm,
        baseline_fspl_db: terrain.baselineFsplDb,
        terrain_penalty_db: terrain.terrainPenaltyDb,
        path_loss_db: terrain.totalPathLossDb,
        rx_dbm: payload.input.include_rx_dbm ? rxDbm : null,
        verdict: payload.input.include_verdict ? verdict : null,
      },
      meta: {
        terrain_source: "copernicus",
        tiles_fetched: terrain.tilesFetched,
        samples_requested: samples,
        samples_used: terrain.samplesUsed,
        max_samples: 500,
        max_intrusion_m: terrain.maxIntrusionM,
        fresnel_clearance_percent: terrain.fresnelClearancePercent,
        terrain_obstructed: terrain.terrainObstructed,
        runtime_ms: runtimeMs,
        max_runtime_ms: MAX_RUNTIME_MS,
      },
    };

    await updateJob(env, jobId, JOB_STATUS.COMPLETED, JSON.stringify(result), null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateJob(env, jobId, JOB_STATUS.FAILED, null, message);
  }
};

export const queueTerrainCalculationJob = async (
  request: Request,
  env: Env,
  payload: CalculationRequest,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> => {
  await ensureCalculationJobsTable(env);
  const limitPerMinute = parsePerMinuteLimit(env.CALC_API_PROXY_RATE_LIMIT_PER_MINUTE, 60);
  const address = getClientAddress(request);
  const limiter = takeRateLimitToken({ key: `calc-jobs:${address}`, limit: limitPerMinute });
  if (!limiter.allowed) {
    return withCors(
      request,
      json(
        { error: "Calculation jobs rate limit reached. Please wait and try again." },
        { status: 429, headers: { "retry-after": String(limiter.retryAfterSec) } },
      ),
    );
  }

  if (payload.input.mode !== "terrain") {
    throw new Error("Only terrain mode is supported on /api/v1/calculate/jobs.");
  }
  validateTerrainRequest(payload);

  const jobId = generateJobId();
  await createJob(env, jobId, JSON.stringify(payload));
  const processing = processTerrainJob(env, jobId, request.url);
  if (waitUntil) waitUntil(processing);
  else await processing;

  return withCors(
    request,
    json(
      {
        job_id: jobId,
        status: JOB_STATUS.QUEUED,
        message: "Job queued. Poll GET /api/v1/calculate/jobs/{job_id} for status.",
      },
      { status: 202 },
    ),
  );
};

export const onRequestOptions = async ({ request }: Context) => handleOptions(request);

export const onRequestPost = async ({ request, env, waitUntil }: Context) => {
  try {
    const payload = normalizeCalculationRequest(await request.json());
    return queueTerrainCalculationJob(request, env, payload, waitUntil);
  } catch (error) {
    return errorResponse(request, error, 400);
  }
};
