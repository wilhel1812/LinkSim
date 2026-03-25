import { getClientAddress, takeRateLimitToken } from "../../_lib/rateLimit";
import { errorResponse, handleOptions, json, withCors } from "../../_lib/http";
import { analyzeTerrainLink } from "../../_lib/terrainAnalysis";
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

const MAX_NODES = 20;
const MAX_DISTANCE_KM = 2000;
const MAX_SAMPLES = 500;
const MAX_RUNTIME_MS = 300000;
const ELEVATION_CHUNK_SIZE = 50;
const ELEVATION_TIMEOUT_MS = 20000;

type JobRow = {
  id: string;
  status: string;
  input_json: string;
  result_json: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type NodeInput = {
  name: string;
  lat: number;
  lon: number;
  tx_power_dbm: number;
  tx_gain_dbi: number;
  rx_gain_dbi: number;
  cable_loss_db: number;
};

type LinkBudgetInput = {
  from_site: string;
  to_site: string;
  frequency_mhz: number;
  rx_target_dbm: number;
  mode: "terrain";
  include_verdict: boolean;
  include_rx_dbm: boolean;
  nodes: NodeInput[];
};

type CalculationRequest = {
  calculation: "link_budget";
  input: LinkBudgetInput;
};

const parsePerMinuteLimit = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const asRecord = (value: unknown, errorMessage: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(errorMessage);
  }
  return value as Record<string, unknown>;
};

const asFiniteNumber = (value: unknown, fieldName: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a valid number.`);
  }
  return value;
};

const asString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required.`);
  }
  return value.trim();
};

const normalizeNode = (value: unknown, index: number): NodeInput => {
  const row = asRecord(value, `nodes[${index}] must be an object.`);
  const lat = asFiniteNumber(row.lat, `nodes[${index}].lat`);
  const lon = asFiniteNumber(row.lon, `nodes[${index}].lon`);
  if (lat < -90 || lat > 90) throw new Error(`nodes[${index}].lat must be between -90 and 90.`);
  if (lon < -180 || lon > 180) throw new Error(`nodes[${index}].lon must be between -180 and 180.`);

  return {
    name: asString(row.name, `nodes[${index}].name`),
    lat,
    lon,
    tx_power_dbm: typeof row.tx_power_dbm === "number" ? row.tx_power_dbm : 14,
    tx_gain_dbi: typeof row.tx_gain_dbi === "number" ? row.tx_gain_dbi : 2,
    rx_gain_dbi: typeof row.rx_gain_dbi === "number" ? row.rx_gain_dbi : 2,
    cable_loss_db: typeof row.cable_loss_db === "number" ? row.cable_loss_db : 1,
  };
};

const normalizeTerrainRequest = (value: unknown): CalculationRequest => {
  const root = asRecord(value, "Request body must be a JSON object.");
  if (root.calculation !== "link_budget") {
    throw new Error("Unsupported calculation type: link_budget is currently the only supported value.");
  }
  const input = asRecord(root.input, "input is required.");
  const nodesRaw = input.nodes;
  if (!Array.isArray(nodesRaw) || nodesRaw.length < 2) {
    throw new Error("input.nodes must contain at least 2 sites.");
  }

  const fromSite =
    typeof input.from_site === "string"
      ? input.from_site
      : typeof input.from_node === "string"
        ? input.from_node
        : "";
  const toSite =
    typeof input.to_site === "string"
      ? input.to_site
      : typeof input.to_node === "string"
        ? input.to_node
        : "";

  const normalizedInput: LinkBudgetInput = {
    from_site: asString(fromSite, "input.from_site"),
    to_site: asString(toSite, "input.to_site"),
    frequency_mhz: asFiniteNumber(input.frequency_mhz, "input.frequency_mhz"),
    rx_target_dbm: typeof input.rx_target_dbm === "number" ? input.rx_target_dbm : -100,
    mode: "terrain",
    include_verdict: typeof input.include_verdict === "boolean" ? input.include_verdict : true,
    include_rx_dbm: typeof input.include_rx_dbm === "boolean" ? input.include_rx_dbm : true,
    nodes: nodesRaw.map((row, index) => normalizeNode(row, index)),
  };

  if (normalizedInput.frequency_mhz <= 0) {
    throw new Error("input.frequency_mhz must be greater than 0.");
  }

  if (normalizedInput.nodes.length > MAX_NODES) {
    throw new Error(`input.nodes exceeds maximum of ${MAX_NODES} sites.`);
  }

  return {
    calculation: "link_budget",
    input: normalizedInput,
  };
};

const haversineKm = (a: NodeInput, b: NodeInput): number => {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = toRadians(a.lat);
  const lon1 = toRadians(a.lon);
  const lat2 = toRadians(b.lat);
  const lon2 = toRadians(b.lon);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const hav =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * (2 * Math.asin(Math.sqrt(hav)));
};

const fsplDb = (distanceKm: number, frequencyMhz: number): number => {
  const safeDistanceKm = Math.max(0.001, distanceKm);
  return 32.44 + 20 * Math.log10(safeDistanceKm) + 20 * Math.log10(frequencyMhz);
};

const interpolateCoordinate = (from: NodeInput, to: NodeInput, t: number): { lat: number; lon: number } => ({
  lat: from.lat + (to.lat - from.lat) * t,
  lon: from.lon + (to.lon - from.lon) * t,
});

const requestWithTimeout = async (url: string): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ELEVATION_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const chunk = <T>(input: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < input.length; i += size) out.push(input.slice(i, i + size));
  return out;
};

const sampleTerrainProfile = async (
  fromNode: NodeInput,
  toNode: NodeInput,
  samples: number,
): Promise<number[]> => {
  const coordinates = Array.from({ length: samples }, (_, i) => {
    const t = samples <= 1 ? 0 : i / (samples - 1);
    return interpolateCoordinate(fromNode, toNode, t);
  });
  const groups = chunk(coordinates, ELEVATION_CHUNK_SIZE);
  const out: number[] = [];

  for (const group of groups) {
    const lat = group.map((c) => c.lat.toFixed(6)).join(",");
    const lon = group.map((c) => c.lon.toFixed(6)).join(",");
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`;
    const response = await requestWithTimeout(url);
    if (!response.ok) {
      throw new Error(`Terrain elevation API failed with status ${response.status}.`);
    }
    const payload = (await response.json()) as { elevation?: unknown };
    if (!Array.isArray(payload.elevation)) {
      throw new Error("Terrain elevation API returned invalid payload.");
    }
    for (const value of payload.elevation) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error("Terrain elevation API returned invalid elevation values.");
      }
      out.push(value);
    }
  }

  if (out.length !== samples) {
    throw new Error("Terrain sampling count mismatch.");
  }
  return out;
};

const estimateTerrainPenaltyDb = (
  elevationsM: number[],
): { terrainPenaltyDb: number; maxIntrusionM: number } => {
  const fromAntennaAbsM = elevationsM[0] + 2;
  const toAntennaAbsM = elevationsM[elevationsM.length - 1] + 2;

  let maxIntrusionM = 0;
  for (let i = 1; i < elevationsM.length - 1; i += 1) {
    const t = i / (elevationsM.length - 1);
    const losM = fromAntennaAbsM + (toAntennaAbsM - fromAntennaAbsM) * t;
    const intrusionM = elevationsM[i] - losM;
    if (intrusionM > maxIntrusionM) maxIntrusionM = intrusionM;
  }

  const terrainPenaltyDb = Math.max(0, Math.min(40, maxIntrusionM * 0.12));
  return { terrainPenaltyDb, maxIntrusionM };
};

const findEndpointNodes = (payload: CalculationRequest): { fromNode: NodeInput; toNode: NodeInput } => {
  const nodesByName = new Map<string, NodeInput>(
    payload.input.nodes.map((node) => [node.name.trim().toLowerCase(), node]),
  );
  const fromNode = nodesByName.get(payload.input.from_site.trim().toLowerCase());
  if (!fromNode) throw new Error(`Site not found: ${payload.input.from_site}`);
  const toNode = nodesByName.get(payload.input.to_site.trim().toLowerCase());
  if (!toNode) throw new Error(`Site not found: ${payload.input.to_site}`);
  return { fromNode, toNode };
};

const estimateSampleCount = (distanceKm: number): number => {
  const byDistance = Math.ceil(distanceKm / 0.5);
  return Math.max(2, Math.min(MAX_SAMPLES, byDistance));
};

const generateJobId = (): string => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "calc_";
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const ensureCalculationJobsTable = async (env: Env): Promise<void> => {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS calculation_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'queued', input_json TEXT NOT NULL, result_json TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_calculation_jobs_status ON calculation_jobs(status)",
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_calculation_jobs_created_at ON calculation_jobs(created_at)",
  ).run();
};

const getJob = async (env: Env, jobId: string): Promise<JobRow | null> => {
  const stmt = env.DB.prepare(
    "SELECT id, status, input_json, result_json, error_message, created_at, updated_at FROM calculation_jobs WHERE id = ?",
  );
  const row = await stmt.bind(jobId).first<JobRow>();
  return row;
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

const processTerrainJob = async (env: Env, jobId: string, requestUrl: string): Promise<void> => {
  const startedAt = Date.now();
  try {
    await updateJob(env, jobId, JOB_STATUS.RUNNING, null, null);
    const row = await getJob(env, jobId);
    if (!row) throw new Error("Job not found while processing.");
    const payload = JSON.parse(row.input_json) as CalculationRequest;
    const { fromNode, toNode } = findEndpointNodes(payload);
    const distanceKm = haversineKm(fromNode, toNode);
    if (distanceKm > MAX_DISTANCE_KM) {
      throw new Error(
        `Distance ${distanceKm.toFixed(1)} km exceeds maximum of ${MAX_DISTANCE_KM} km for terrain jobs.`,
      );
    }
    const samples = estimateSampleCount(distanceKm);

    const terrainResult = await analyzeTerrainLink(
      env,
      requestUrl,
      fromNode.lat,
      fromNode.lon,
      toNode.lat,
      toNode.lon,
      payload.input.frequency_mhz,
      fromNode.tx_power_dbm,
      toNode.rx_gain_dbi,
      samples,
    );

    const eirpDbm = fromNode.tx_power_dbm + fromNode.tx_gain_dbi - fromNode.cable_loss_db;
    const rxDbm = eirpDbm + toNode.rx_gain_dbi - terrainResult.totalPathLossDb;
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
        distance_km: terrainResult.distanceKm,
        baseline_fspl_db: terrainResult.baselineFsplDb,
        terrain_penalty_db: terrainResult.terrainPenaltyDb,
        path_loss_db: terrainResult.totalPathLossDb,
        rx_dbm: payload.input.include_rx_dbm ? rxDbm : null,
        verdict: payload.input.include_verdict ? verdict : null,
      },
      meta: {
        terrain_source: "copernicus",
        tiles_fetched: terrainResult.tilesFetched,
        samples_requested: samples,
        samples_used: terrainResult.samplesUsed,
        max_samples: MAX_SAMPLES,
        max_intrusion_m: terrainResult.maxIntrusionM,
        fresnel_clearance_percent: terrainResult.fresnelClearancePercent,
        terrain_obstructed: terrainResult.terrainObstructed,
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

export const onRequestOptions = async ({ request }: Context) => handleOptions(request);

export const onRequestPost = async ({ request, env, waitUntil }: Context) => {
  try {
    await ensureCalculationJobsTable(env);
    const limitPerMinute = parsePerMinuteLimit(env.CALC_API_PROXY_RATE_LIMIT_PER_MINUTE, 60);
    const address = getClientAddress(request);
    const limiter = takeRateLimitToken({ key: `calc-jobs:${address}`, limit: limitPerMinute });
    if (!limiter.allowed) {
      return withCors(
        request,
        json(
          { error: "Calculation jobs rate limit reached. Please wait and try again." },
          {
            status: 429,
            headers: {
              "retry-after": String(limiter.retryAfterSec),
            },
          },
        ),
      );
    }

    const payload = normalizeTerrainRequest(await request.json());

    const jobId = generateJobId();
    const inputJson = JSON.stringify(payload);

    await createJob(env, jobId, inputJson);
    const processing = processTerrainJob(env, jobId, request.url);
    if (waitUntil) {
      waitUntil(processing);
    } else {
      await processing;
    }

    return withCors(
      request,
      json({
        job_id: jobId,
        status: JOB_STATUS.QUEUED,
        message: "Job queued. Poll GET /api/v1/calculate/jobs/{job_id} for status.",
      }),
    );
  } catch (error) {
    return errorResponse(request, error, 400);
  }
};
