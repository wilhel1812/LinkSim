import { analyzeLink } from "../../../src/lib/propagation";
import { defaultPropagationEnvironment } from "../../../src/lib/propagationEnvironment";
import { errorResponse, handleOptions, json, withCors } from "../../_lib/http";
import { getClientAddress, takeRateLimitToken } from "../../_lib/rateLimit";
import {
  findEndpointNodes,
  haversineKm,
  MAX_SYNC_DISTANCE_KM,
  normalizeCalculationRequest,
  toSitesAndLink,
  type CalculationRequest,
} from "../../_lib/calculateShared";
import type { Env } from "../../_lib/types";

type Context = { request: Request; env: Env };

const parsePerMinuteLimit = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const validateSyncDistance = (payload: CalculationRequest): void => {
  const { fromNode, toNode } = findEndpointNodes(payload);
  const distanceKm = haversineKm(fromNode, toNode);
  if (distanceKm > MAX_SYNC_DISTANCE_KM) {
    throw new Error(
      `Distance ${distanceKm.toFixed(1)} km exceeds maximum of ${MAX_SYNC_DISTANCE_KM} km for synchronous calculation. ` +
        "Use POST /api/v1/calculate/jobs for longer paths.",
    );
  }
};

const calculateFast = (payload: CalculationRequest) => {
  if (payload.input.mode === "terrain") {
    throw new Error(
      `Terrain mode is not available on synchronous /api/v1/calculate. Use POST /api/v1/calculate/jobs for terrain-aware calculations (supports up to ${MAX_SYNC_DISTANCE_KM} km).`,
    );
  }

  validateSyncDistance(payload);
  const { fromNode, toNode } = findEndpointNodes(payload);
  const { fromSite, toSite, link } = toSitesAndLink(payload, 0, 0);
  const analysis = analyzeLink(link, fromSite, toSite, "FSPL", undefined, {
    environment: defaultPropagationEnvironment(),
  });
  const verdict = analysis.rxLevelDbm >= payload.input.rx_target_dbm ? "PASS" : "FAIL";

  return {
    calculation: "link_budget",
    mode: "fast",
    terrain_used: false,
    result: {
      from_site: fromNode.name,
      to_site: toNode.name,
      distance_km: analysis.distanceKm,
      path_loss_db: analysis.pathLossDb,
      rx_dbm: payload.input.include_rx_dbm ? analysis.rxLevelDbm : null,
      verdict: payload.input.include_verdict ? verdict : null,
    },
  };
};

export const onRequestOptions = async ({ request }: Context) => handleOptions(request);

export const onRequestPost = async ({ request, env }: Context) => {
  try {
    const limitPerMinute = parsePerMinuteLimit(env.CALC_API_PROXY_RATE_LIMIT_PER_MINUTE, 120);
    const address = getClientAddress(request);
    const limiter = takeRateLimitToken({ key: `calc-api:${address}`, limit: limitPerMinute });
    if (!limiter.allowed) {
      return withCors(
        request,
        json(
          { error: "Calculation API rate limit reached. Please wait and try again." },
          { status: 429, headers: { "retry-after": String(limiter.retryAfterSec) } },
        ),
      );
    }

    const payload = normalizeCalculationRequest(await request.json());
    return withCors(request, json(calculateFast(payload)));
  } catch (error) {
    return errorResponse(request, error, 400);
  }
};
