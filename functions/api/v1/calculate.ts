import { getClientAddress, takeRateLimitToken } from "../../_lib/rateLimit";
import { errorResponse, handleOptions, json, withCors } from "../../_lib/http";
import type { Env } from "../../_lib/types";
import { fromArrayBuffer } from "geotiff";
import { analyzeLink } from "../../../src/lib/propagation";
import { defaultPropagationEnvironment } from "../../../src/lib/propagationEnvironment";
import { classifyPassFailState, passFailStateLabel } from "../../../src/lib/passFailState";
import { sampleSrtmElevation } from "../../../src/lib/srtm";
import { tilesForBounds } from "../../../src/lib/terrainTiles";
import type { Link, Site, SrtmTile } from "../../../src/types/radio";

type Context = {
  request: Request;
  env: Env;
};

const parsePerMinuteLimit = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

type LinkBudgetNodeInput = {
  name?: unknown;
  lat?: unknown;
  lon?: unknown;
  antenna_height_m?: unknown;
  tx_power_dbm?: unknown;
  tx_gain_dbi?: unknown;
  rx_gain_dbi?: unknown;
  cable_loss_db?: unknown;
  ground_elevation_m?: unknown;
};

type LinkBudgetInput = {
  from_site?: unknown;
  from_node?: unknown;
  to_site?: unknown;
  to_node?: unknown;
  frequency_mhz?: unknown;
  rx_target_dbm?: unknown;
  include_verdict?: unknown;
  include_rx_dbm?: unknown;
  environment_loss_db?: unknown;
  nodes?: unknown;
};

type CalculationRequestPayload = {
  calculation?: unknown;
  input?: unknown;
};

const asNumberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBooleanOr = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const normalizeNodeName = (value: string): string => value.trim().toLowerCase();

const parseCopernicusKey = (entry: string): string | null => {
  const match = entry.match(/Copernicus_DSM_COG_\d+_([NS])(\d{2})_00_([EW])(\d{3})_00_DEM/i);
  if (!match) return null;
  return `${match[1].toUpperCase()}${match[2]}${match[3].toUpperCase()}${match[4]}`;
};

const tilePathForEntry = (entry: string): string => `${entry}/${entry}.tif`;

const parseTileList = (raw: string): Record<string, string> => {
  const byKey: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry) continue;
    const key = parseCopernicusKey(entry);
    if (!key) continue;
    byKey[key] = tilePathForEntry(entry);
  }
  return byKey;
};

const parseCopernicusTile = async (tileKey: string, buffer: ArrayBuffer): Promise<SrtmTile> => {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const [minLon, minLat] = image.getBoundingBox();
  const nodata = image.getGDALNoData();
  const raster = await image.readRasters({ interleave: true, samples: [0] });
  const nodataNumeric = nodata === null ? NaN : Number(nodata);
  const elevations = new Int16Array(width * height);
  for (let i = 0; i < elevations.length; i += 1) {
    const value = Number((raster as ArrayLike<number>)[i]);
    if (!Number.isFinite(value) || (Number.isFinite(nodataNumeric) && Math.abs(value - nodataNumeric) <= 0.01)) {
      elevations[i] = -32768;
      continue;
    }
    elevations[i] = Math.max(-32767, Math.min(32767, Math.round(value)));
  }

  return {
    key: tileKey,
    latStart: Math.floor(minLat),
    lonStart: Math.floor(minLon),
    size: Math.max(width, height),
    width,
    height,
    arcSecondSpacing: 1,
    elevations,
  };
};

const loadCopernicusTilesForSites = async (request: Request, nodes: Array<{ lat: number; lon: number }>): Promise<SrtmTile[]> => {
  if (!nodes.length) return [];
  const minLat = Math.min(...nodes.map((node) => node.lat));
  const maxLat = Math.max(...nodes.map((node) => node.lat));
  const minLon = Math.min(...nodes.map((node) => node.lon));
  const maxLon = Math.max(...nodes.map((node) => node.lon));

  const origin = new URL(request.url).origin;
  const tileListResponse = await fetch(`${origin}/copernicus/30m/tileList.txt`);
  if (!tileListResponse.ok) throw new Error(`Unable to load Copernicus tile list (HTTP ${tileListResponse.status})`);
  const tileListByKey = parseTileList(await tileListResponse.text());

  const neededKeys = tilesForBounds(minLat, maxLat, minLon, maxLon);
  const tiles: SrtmTile[] = [];

  for (const key of neededKeys) {
    const path = tileListByKey[key];
    if (!path) continue;
    const tileResponse = await fetch(`${origin}/copernicus/30m/${path}`);
    if (!tileResponse.ok) continue;
    const parsed = await parseCopernicusTile(key, await tileResponse.arrayBuffer());
    tiles.push(parsed);
  }

  return tiles;
};

const toSite = (
  node: LinkBudgetNodeInput,
  id: string,
  sampledGroundM: number,
): Site => ({
  id,
  name: id,
  position: {
    lat: asNumberOr(node.lat, 0),
    lon: asNumberOr(node.lon, 0),
  },
  groundElevationM: sampledGroundM,
  antennaHeightM: asNumberOr(node.antenna_height_m, 2),
  txPowerDbm: asNumberOr(node.tx_power_dbm, 14),
  txGainDbi: asNumberOr(node.tx_gain_dbi, 2),
  rxGainDbi: asNumberOr(node.rx_gain_dbi, 2),
  cableLossDb: asNumberOr(node.cable_loss_db, 1),
});

const validateInput = (raw: unknown): { ok: true; value: LinkBudgetInput } | { ok: false; message: string } => {
  if (!raw || typeof raw !== "object") return { ok: false, message: "Missing input payload." };
  const input = raw as LinkBudgetInput;
  const nodes = Array.isArray(input.nodes) ? input.nodes : null;
  if (!nodes || nodes.length < 2) {
    return { ok: false, message: "At least two nodes are required." };
  }
  return { ok: true, value: input };
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
          {
            status: 429,
            headers: {
              "retry-after": String(limiter.retryAfterSec),
            },
          },
        ),
      );
    }

    const payload = (await request.json()) as CalculationRequestPayload;
    if (payload.calculation !== "link_budget") {
      return withCors(request, json({ error: "Unsupported calculation type: link_budget expected." }, { status: 400 }));
    }

    const parsedInput = validateInput(payload.input);
    if (!parsedInput.ok) {
      return withCors(request, json({ error: parsedInput.message }, { status: 400 }));
    }

    const input = parsedInput.value;
    const fromName = asNonEmptyString(input.from_site) ?? asNonEmptyString(input.from_node);
    const toName = asNonEmptyString(input.to_site) ?? asNonEmptyString(input.to_node);
    if (!fromName || !toName) {
      return withCors(request, json({ error: "Both from_site and to_site are required." }, { status: 400 }));
    }

    const nodes = (input.nodes as LinkBudgetNodeInput[]).filter((node) => {
      const name = asNonEmptyString(node.name);
      return (
        name !== null &&
        typeof node.lat === "number" &&
        typeof node.lon === "number" &&
        Number.isFinite(node.lat) &&
        Number.isFinite(node.lon)
      );
    });
    const fromNode = nodes.find((node) => normalizeNodeName(String(node.name)) === normalizeNodeName(fromName));
    const toNode = nodes.find((node) => normalizeNodeName(String(node.name)) === normalizeNodeName(toName));
    if (!fromNode || !toNode) {
      return withCors(request, json({ error: "Site not found in nodes." }, { status: 404 }));
    }

    const terrainTiles = await loadCopernicusTilesForSites(request, [
      { lat: asNumberOr(fromNode.lat, 0), lon: asNumberOr(fromNode.lon, 0) },
      { lat: asNumberOr(toNode.lat, 0), lon: asNumberOr(toNode.lon, 0) },
    ]);

    const sampledFromGround =
      sampleSrtmElevation(terrainTiles, asNumberOr(fromNode.lat, 0), asNumberOr(fromNode.lon, 0)) ??
      asNumberOr(fromNode.ground_elevation_m, 0);
    const sampledToGround =
      sampleSrtmElevation(terrainTiles, asNumberOr(toNode.lat, 0), asNumberOr(toNode.lon, 0)) ??
      asNumberOr(toNode.ground_elevation_m, 0);

    const fromSite = toSite(fromNode, String(fromNode.name), sampledFromGround);
    const toSiteNode = toSite(toNode, String(toNode.name), sampledToGround);

    const frequencyMHz = asNumberOr(input.frequency_mhz, 868);
    const link: Link = {
      id: `${fromSite.id}->${toSiteNode.id}`,
      fromSiteId: fromSite.id,
      toSiteId: toSiteNode.id,
      frequencyMHz,
      txPowerDbm: fromSite.txPowerDbm,
      txGainDbi: fromSite.txGainDbi,
      rxGainDbi: toSiteNode.rxGainDbi,
      cableLossDb: fromSite.cableLossDb,
    };

    const analysis = analyzeLink(
      link,
      fromSite,
      toSiteNode,
      "ITM",
      ({ lat, lon }) => sampleSrtmElevation(terrainTiles, lat, lon),
      {
        terrainSamples: 32,
        environment: defaultPropagationEnvironment(),
      },
    );

    const environmentLossDb = Math.max(0, asNumberOr(input.environment_loss_db, 0));
    const rxAfterEnvLossDbm = analysis.rxLevelDbm - environmentLossDb;
    const rxTargetDbm = asNumberOr(input.rx_target_dbm, -120);
    const pass = rxAfterEnvLossDbm >= rxTargetDbm;
    const passFailState = classifyPassFailState(pass, analysis.terrainObstructed);
    const verdict = pass ? "PASS" : "FAIL";

    const result = {
      from_site: fromSite.name,
      to_site: toSiteNode.name,
      distance_km: analysis.distanceKm,
      path_loss_db: analysis.pathLossDb,
      fspl_db: analysis.fsplDb,
      terrain_penalty_db: Math.max(0, analysis.pathLossDb - analysis.fsplDb),
      terrain_obstructed: analysis.terrainObstructed,
      rx_dbm: asBooleanOr(input.include_rx_dbm, true) ? analysis.rxLevelDbm : null,
      rx_after_env_loss_dbm: rxAfterEnvLossDbm,
      verdict: asBooleanOr(input.include_verdict, true) ? verdict : null,
      pass_fail_label: passFailStateLabel(passFailState),
      summary: `${passFailStateLabel(passFailState)} at ${analysis.distanceKm.toFixed(2)} km (${rxAfterEnvLossDbm.toFixed(1)} dBm after env loss)`,
      terrain_source: "copernicus30",
      terrain_tiles_loaded: terrainTiles.map((tile) => tile.key),
      from_ground_elevation_m: sampledFromGround,
      to_ground_elevation_m: sampledToGround,
      from_antenna_height_m: fromSite.antennaHeightM,
      to_antenna_height_m: toSiteNode.antennaHeightM,
    };

    return withCors(
      request,
      json({ calculation: "link_budget", result }),
    );
  } catch (error) {
    return errorResponse(request, error, 502);
  }
};
