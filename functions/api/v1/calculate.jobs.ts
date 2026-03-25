import { getClientAddress, takeRateLimitToken } from "../../_lib/rateLimit";
import { errorResponse, handleOptions, json, withCors } from "../../_lib/http";
import type { Env } from "../../_lib/types";

type Context = {
  request: Request;
  env: Env;
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

const generateJobId = (): string => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "calc_";
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const getJob = async (env: Env, jobId: string) => {
  const stmt = env.DB.prepare(
    "SELECT id, status, input_json, result_json, error_message, created_at, updated_at FROM calculation_jobs WHERE id = ?",
  );
  const row = await stmt.bind(jobId).first<{
    id: string;
    status: string;
    input_json: string;
    result_json: string | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
  }>();
  return row;
};

const createJob = async (env: Env, jobId: string, inputJson: string): Promise<void> => {
  const stmt = env.DB.prepare(
    "INSERT INTO calculation_jobs (id, status, input_json, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
  );
  await stmt.bind(jobId, JOB_STATUS.QUEUED, inputJson).run();
};

export const onRequestOptions = async ({ request }: Context) => handleOptions(request);

export const onRequestPost = async ({ request, env }: Context) => {
  try {
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
