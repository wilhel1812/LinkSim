import { errorResponse, handleOptions, json, readBoundedJson, withCors } from "../../_lib/http";
import { getClientAddress, parsePerMinuteLimit, takeRateLimitToken } from "../../_lib/rateLimit";
import { analyzeTerrainLink } from "../../_lib/terrainAnalysis";
import {
  estimateSampleCount, effectiveApiLinkGains, findEndpointNodes, haversineKm,
  MAX_CALCULATION_BODY_BYTES, MAX_CALCULATION_JSON_DEPTH, MAX_JOB_RUNTIME_MS,
  MAX_TERRAIN_DISTANCE_KM, normalizeCalculationRequest,
  type CalculationRequest,
} from "../../_lib/calculateShared";
import {
  cleanupCalculationJobs, createCalculationJob, ensureCalculationJobsTable,
  finishCalculationJobBeforeDeadline, getCalculationJob, JOB_STATUS, transitionCalculationJob,
  timeoutCalculationJob,
} from "../../_lib/calculationJobs";
import type { Env } from "../../_lib/types";

type Context = { request: Request; env: Env; waitUntil?: (promise: Promise<unknown>) => void };

const generateJobId = (): string => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "calc_";
  for (let i = 0; i < 16; i += 1) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

export const validateTerrainRequest = (payload: CalculationRequest): { distanceKm: number; samples: number } => {
  const { fromNode, toNode } = findEndpointNodes(payload);
  const distanceKm = haversineKm(fromNode, toNode);
  if (distanceKm > MAX_TERRAIN_DISTANCE_KM) throw new Error(`Distance ${distanceKm.toFixed(1)} km exceeds maximum of ${MAX_TERRAIN_DISTANCE_KM} km for terrain jobs.`);
  return { distanceKm, samples: estimateSampleCount(distanceKm) };
};

export const processTerrainJob = async (env: Env, jobId: string, requestUrl: string): Promise<void> => {
  const row = await getCalculationJob(env, jobId);
  if (!row) return;
  const createdAt = row.created_at.includes("T") ? row.created_at : `${row.created_at.replace(" ", "T")}Z`;
  const createdAtMs = Date.parse(createdAt);
  const deadlineMs = (Number.isFinite(createdAtMs) ? createdAtMs : Date.now()) + MAX_JOB_RUNTIME_MS;
  if (!await transitionCalculationJob(env, jobId, [JOB_STATUS.QUEUED], JOB_STATUS.RUNNING, null, null)) return;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DOMException("Terrain job timed out.", "TimeoutError"));
    }, Math.max(0, deadlineMs - Date.now()));
  });
  try {
    const payload = normalizeCalculationRequest(JSON.parse(row.input_json));
    const { fromNode, toNode } = findEndpointNodes(payload);
    const { samples } = validateTerrainRequest(payload);
    const terrain = await Promise.race([
      analyzeTerrainLink(env, requestUrl, {
        lat: fromNode.lat, lon: fromNode.lon, name: fromNode.name, txPowerDbm: fromNode.tx_power_dbm,
        txGainDbi: fromNode.tx_gain_dbi, rxGainDbi: fromNode.rx_gain_dbi, cableLossDb: fromNode.cable_loss_db,
        antennaHeightM: fromNode.antenna_height_m ?? 2,
      }, {
        lat: toNode.lat, lon: toNode.lon, name: toNode.name, txPowerDbm: toNode.tx_power_dbm,
        txGainDbi: toNode.tx_gain_dbi, rxGainDbi: toNode.rx_gain_dbi, cableLossDb: toNode.cable_loss_db,
        antennaHeightM: toNode.antenna_height_m ?? 2,
      }, payload.input.frequency_mhz, samples, controller.signal),
      timeout,
    ]);
    if (Date.now() >= deadlineMs) {
      controller.abort();
      await timeoutCalculationJob(env, jobId);
      return;
    }
    const directionalGains = effectiveApiLinkGains(payload, terrain.fromGroundM, terrain.toGroundM);
    const eirpDbm = fromNode.tx_power_dbm + directionalGains.txGainDbi - fromNode.cable_loss_db;
    const rxDbm = eirpDbm + directionalGains.rxGainDbi - terrain.totalPathLossDb;
    const runtimeMs = Math.max(0, Date.now() - (Number.isFinite(createdAtMs) ? createdAtMs : Date.now()));
    const result = {
      calculation: "link_budget", mode: "terrain", terrain_used: true, terrain_status: "sampled",
      result: { from_site: fromNode.name, to_site: toNode.name, distance_km: terrain.distanceKm,
        baseline_fspl_db: terrain.baselineFsplDb, terrain_penalty_db: terrain.terrainPenaltyDb,
        path_loss_db: terrain.totalPathLossDb, rx_dbm: payload.input.include_rx_dbm ? rxDbm : null,
        verdict: payload.input.include_verdict ? (rxDbm >= payload.input.rx_target_dbm ? "PASS" : "FAIL") : null },
      meta: { terrain_source: "copernicus", tiles_fetched: terrain.tilesFetched, samples_requested: samples,
        samples_used: terrain.samplesUsed, max_samples: 500, max_intrusion_m: terrain.maxIntrusionM,
        fresnel_clearance_percent: terrain.fresnelClearancePercent, terrain_obstructed: terrain.terrainObstructed,
        runtime_ms: runtimeMs, max_runtime_ms: MAX_JOB_RUNTIME_MS },
    };
    if (!await finishCalculationJobBeforeDeadline(env, jobId, JOB_STATUS.COMPLETED, JSON.stringify(result), null)) {
      await timeoutCalculationJob(env, jobId);
    }
  } catch (error) {
    const timedOut = controller.signal.aborted || (error instanceof DOMException && error.name === "TimeoutError");
    if (timedOut) await timeoutCalculationJob(env, jobId);
    else if (!await finishCalculationJobBeforeDeadline(
      env,
      jobId,
      JOB_STATUS.FAILED,
      null,
      error instanceof Error ? error.message : String(error),
    )) await timeoutCalculationJob(env, jobId);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await cleanupCalculationJobs(env).catch(() => undefined);
  }
};

export const queueTerrainCalculationJob = async (request: Request, env: Env, payload: CalculationRequest, waitUntil?: (promise: Promise<unknown>) => void): Promise<Response> => {
  await ensureCalculationJobsTable(env);
  const limiter = takeRateLimitToken({ key: `calc-jobs:${getClientAddress(request)}`, limit: parsePerMinuteLimit(env.CALC_API_PROXY_RATE_LIMIT_PER_MINUTE, 60) });
  if (!limiter.allowed) return withCors(request, json({ error: "Calculation jobs rate limit reached. Please wait and try again." }, { status: 429, headers: { "retry-after": String(limiter.retryAfterSec) } }));
  if (payload.input.mode !== "terrain") throw new Error("Only terrain mode is supported on /api/v1/calculate/jobs.");
  validateTerrainRequest(payload);
  await cleanupCalculationJobs(env);
  const jobId = generateJobId();
  await createCalculationJob(env, jobId, JSON.stringify(payload));
  const processing = processTerrainJob(env, jobId, request.url);
  if (waitUntil) waitUntil(processing); else await processing;
  return withCors(request, json({ job_id: jobId, status: JOB_STATUS.QUEUED, message: "Job queued. Poll GET /api/v1/calculate/jobs/{job_id} for status." }, { status: 202 }));
};

export const onRequestOptions = async ({ request }: Context) => handleOptions(request);
export const onRequestPost = async ({ request, env, waitUntil }: Context) => {
  try {
    const raw = await readBoundedJson<unknown>(request, { maxBytes: MAX_CALCULATION_BODY_BYTES, maxDepth: MAX_CALCULATION_JSON_DEPTH });
    return queueTerrainCalculationJob(request, env, normalizeCalculationRequest(raw), waitUntil);
  } catch (error) { return errorResponse(request, error, 400); }
};
