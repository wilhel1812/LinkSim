import { getClientAddress, takeRateLimitToken } from "../../_lib/rateLimit";
import { errorResponse, handleOptions, json, withCors } from "../../_lib/http";
import type { Env } from "../../_lib/types";
import { queueTerrainCalculationJob } from "./calculate.jobs";
import {
  findEndpointNodes,
  haversineKm,
  MAX_SYNC_DISTANCE_KM,
  normalizeCalculationRequest,
} from "../../_lib/calculateShared";
import { analyzeTerrainLink } from "../../_lib/terrainAnalysis";
import { classifyPassFailState, passFailStateLabel } from "../../../src/lib/passFailState";

type Context = {
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
};

const MAX_SYNC_TERRAIN_SAMPLES = 72;

const parsePerMinuteLimit = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const estimateSyncSamples = (distanceKm: number): number => {
  const byDistance = Math.ceil(distanceKm / 0.75);
  return Math.max(24, Math.min(MAX_SYNC_TERRAIN_SAMPLES, byDistance));
};

export const onRequestOptions = async ({ request }: Context) => handleOptions(request);

export const onRequestPost = async (ctx: Context) => {
  const { request, env, waitUntil } = ctx;
  try {
    const limitPerMinute = parsePerMinuteLimit(env.CALC_API_PROXY_RATE_LIMIT_PER_MINUTE, 120);
    const address = getClientAddress(request);
    const limiter = takeRateLimitToken({ key: `calc-api:${address}`, limit: limitPerMinute });
    if (!limiter.allowed) {
      return withCors(
        request,
        json(
          { error: "Calculation API rate limit reached. Please wait and try again." },
          {
            status: 429,
            headers: { "retry-after": String(limiter.retryAfterSec) },
          },
        ),
      );
    }

    const payload = normalizeCalculationRequest(await request.json());
    if (payload.input.mode === "terrain") {
      return queueTerrainCalculationJob(request, env, payload, waitUntil);
    }

    const { fromNode, toNode } = findEndpointNodes(payload);
    const distanceKm = haversineKm(fromNode, toNode);
    if (distanceKm > MAX_SYNC_DISTANCE_KM) {
      return withCors(
        request,
        json(
          {
            error: `Distance ${distanceKm.toFixed(1)} km exceeds maximum sync distance of ${MAX_SYNC_DISTANCE_KM} km. Use /api/v1/calculate/jobs for long terrain paths.`,
          },
          { status: 400 },
        ),
      );
    }

    const terrain = await analyzeTerrainLink(
      env,
      request.url,
      {
        lat: fromNode.lat,
        lon: fromNode.lon,
        name: fromNode.name,
        txPowerDbm: fromNode.tx_power_dbm,
        txGainDbi: fromNode.tx_gain_dbi,
        rxGainDbi: fromNode.rx_gain_dbi,
        cableLossDb: fromNode.cable_loss_db,
        antennaHeightM: fromNode.antenna_height_m ?? 2,
        groundElevationM: fromNode.ground_elevation_m,
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
        groundElevationM: toNode.ground_elevation_m,
      },
      payload.input.frequency_mhz,
      estimateSyncSamples(distanceKm),
    );

    const eirpDbm = fromNode.tx_power_dbm + fromNode.tx_gain_dbi - fromNode.cable_loss_db;
    const rxDbm = eirpDbm + toNode.rx_gain_dbi - terrain.totalPathLossDb;
    const environmentLossDb = Math.max(0, payload.input.environment_loss_db);
    const rxAfterEnvLossDbm = rxDbm - environmentLossDb;
    const pass = rxAfterEnvLossDbm >= payload.input.rx_target_dbm;
    const verdict = pass ? "PASS" : "FAIL";
    const passFailState = classifyPassFailState(pass, terrain.terrainObstructed);
    const passFailLabel = passFailStateLabel(passFailState);

    return withCors(
      request,
      json({
        calculation: "link_budget",
        result: {
          from_site: fromNode.name,
          to_site: toNode.name,
          distance_km: terrain.distanceKm,
          path_loss_db: terrain.totalPathLossDb,
          fspl_db: terrain.baselineFsplDb,
          terrain_penalty_db: terrain.terrainPenaltyDb,
          terrain_obstructed: terrain.terrainObstructed,
          rx_dbm: payload.input.include_rx_dbm ? rxDbm : null,
          rx_after_env_loss_dbm: rxAfterEnvLossDbm,
          verdict: payload.input.include_verdict ? verdict : null,
          pass_fail_label: passFailLabel,
          summary: `${passFailLabel} at ${terrain.distanceKm.toFixed(2)} km (${rxAfterEnvLossDbm.toFixed(1)} dBm after env loss)`,
          terrain_source: "copernicus",
          terrain_tiles_loaded: terrain.tilesFetched,
          from_ground_elevation_m: terrain.fromGroundM,
          to_ground_elevation_m: terrain.toGroundM,
          from_antenna_height_m: fromNode.antenna_height_m ?? 2,
          to_antenna_height_m: toNode.antenna_height_m ?? 2,
        },
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("Site not found:")) {
      return withCors(request, json({ error: message }, { status: 404 }));
    }
    if (message.includes("must") || message.includes("required") || message.includes("Unsupported calculation type")) {
      return withCors(request, json({ error: message }, { status: 400 }));
    }
    if (message.includes("No terrain tiles available")) {
      return withCors(
        request,
        json(
          {
            error: "Terrain tiles unavailable for this path. Please retry shortly or use /api/v1/calculate/jobs.",
          },
          { status: 503 },
        ),
      );
    }
    return errorResponse(request, error, 502);
  }
};
