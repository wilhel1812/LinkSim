import type { Link, Site } from "../../src/types/radio";
import { effectiveGainTowardSiteDbi } from "../../src/lib/antennaPattern";

export type NodeInput = {
  name: string;
  lat: number;
  lon: number;
  tx_power_dbm: number;
  tx_gain_dbi: number;
  rx_gain_dbi: number;
  cable_loss_db: number;
  antenna_height_m?: number;
  ground_elevation_m?: number;
  antenna_mode?: "omnidirectional" | "directional";
  antenna_azimuth_deg?: number;
  antenna_tilt_deg?: number;
  antenna_horizontal_beamwidth_deg?: number;
  antenna_vertical_beamwidth_deg?: number;
  antenna_max_attenuation_db?: number;
};

export type LinkBudgetInput = {
  from_site: string;
  to_site: string;
  frequency_mhz: number;
  rx_target_dbm: number;
  environment_loss_db: number;
  mode: "fast" | "terrain";
  include_verdict: boolean;
  include_rx_dbm: boolean;
  nodes: NodeInput[];
};

export type CalculationRequest = {
  calculation: "link_budget";
  input: LinkBudgetInput;
};

export const MAX_NODES = 20;
export const MAX_CALCULATION_BODY_BYTES = 64 * 1024;
export const MAX_CALCULATION_JSON_DEPTH = 10;
export const MAX_NODE_NAME_LENGTH = 80;
export const MAX_SYNC_DISTANCE_KM = 500;
export const MAX_TERRAIN_DISTANCE_KM = 2000;
export const MAX_SAMPLES = 500;
export const MAX_SYNC_TERRAIN_SAMPLES = 72;
export const MAX_JOB_RUNTIME_MS = 5 * 60 * 1000;
export const MAX_JOB_ERROR_LENGTH = 1024;
export const TERMINAL_JOB_RETENTION_HOURS = 24;
export const MAX_TERMINAL_JOBS = 1000;

const asRecord = (value: unknown, errorMessage: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorMessage);
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
  const normalized = value.trim();
  if (Array.from(normalized).length > MAX_NODE_NAME_LENGTH) {
    throw new Error(`${fieldName} may not exceed ${MAX_NODE_NAME_LENGTH} characters.`);
  }
  return normalized;
};

const normalizeBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const normalizeMode = (value: unknown): "fast" | "terrain" => (value === "terrain" ? "terrain" : "fast");

const normalizeAntennaMode = (
  value: unknown,
  fieldName: string,
): "omnidirectional" | "directional" => {
  if (value === undefined || value === null || value === "omnidirectional") return "omnidirectional";
  if (value === "directional") return "directional";
  throw new Error(`${fieldName} must be omnidirectional or directional.`);
};

const optionalNumberInRange = (value: unknown, fieldName: string, min: number, max: number): number | undefined => {
  if (value === undefined) return undefined;
  const number = asFiniteNumber(value, fieldName);
  if (number < min || number > max) throw new Error(`${fieldName} must be between ${min} and ${max}.`);
  return number;
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
    tx_power_dbm: row.tx_power_dbm === undefined ? 14 : asFiniteNumber(row.tx_power_dbm, `nodes[${index}].tx_power_dbm`),
    tx_gain_dbi: row.tx_gain_dbi === undefined ? 2 : asFiniteNumber(row.tx_gain_dbi, `nodes[${index}].tx_gain_dbi`),
    rx_gain_dbi: row.rx_gain_dbi === undefined ? 2 : asFiniteNumber(row.rx_gain_dbi, `nodes[${index}].rx_gain_dbi`),
    cable_loss_db: row.cable_loss_db === undefined ? 1 : asFiniteNumber(row.cable_loss_db, `nodes[${index}].cable_loss_db`),
    antenna_height_m: row.antenna_height_m === undefined ? 2 : asFiniteNumber(row.antenna_height_m, `nodes[${index}].antenna_height_m`),
    ground_elevation_m: row.ground_elevation_m === undefined ? undefined : asFiniteNumber(row.ground_elevation_m, `nodes[${index}].ground_elevation_m`),
    antenna_mode: normalizeAntennaMode(row.antenna_mode, `nodes[${index}].antenna_mode`),
    antenna_azimuth_deg: optionalNumberInRange(row.antenna_azimuth_deg, `nodes[${index}].antenna_azimuth_deg`, 0, 359.999),
    antenna_tilt_deg: optionalNumberInRange(row.antenna_tilt_deg, `nodes[${index}].antenna_tilt_deg`, -90, 90),
    antenna_horizontal_beamwidth_deg: optionalNumberInRange(row.antenna_horizontal_beamwidth_deg, `nodes[${index}].antenna_horizontal_beamwidth_deg`, 1, 180),
    antenna_vertical_beamwidth_deg: optionalNumberInRange(row.antenna_vertical_beamwidth_deg, `nodes[${index}].antenna_vertical_beamwidth_deg`, 1, 180),
    antenna_max_attenuation_db: optionalNumberInRange(row.antenna_max_attenuation_db, `nodes[${index}].antenna_max_attenuation_db`, 0, 60),
  };
};

export const normalizeCalculationRequest = (value: unknown): CalculationRequest => {
  const root = asRecord(value, "Request body must be a JSON object.");
  if (root.calculation !== "link_budget") {
    throw new Error("Unsupported calculation type: link_budget is currently the only supported value.");
  }
  const input = asRecord(root.input, "input is required.");
  const nodesRaw = input.nodes;
  if (!Array.isArray(nodesRaw) || nodesRaw.length < 2) {
    throw new Error("input.nodes must contain at least 2 sites.");
  }

  const fromSite = typeof input.from_site === "string" ? input.from_site : typeof input.from_node === "string" ? input.from_node : "";
  const toSite = typeof input.to_site === "string" ? input.to_site : typeof input.to_node === "string" ? input.to_node : "";

  const normalizedInput: LinkBudgetInput = {
    from_site: asString(fromSite, "input.from_site"),
    to_site: asString(toSite, "input.to_site"),
    frequency_mhz: asFiniteNumber(input.frequency_mhz, "input.frequency_mhz"),
    rx_target_dbm: input.rx_target_dbm === undefined ? -100 : asFiniteNumber(input.rx_target_dbm, "input.rx_target_dbm"),
    environment_loss_db: input.environment_loss_db === undefined ? 0 : asFiniteNumber(input.environment_loss_db, "input.environment_loss_db"),
    mode: normalizeMode(input.mode),
    include_verdict: normalizeBool(input.include_verdict, true),
    include_rx_dbm: normalizeBool(input.include_rx_dbm, true),
    nodes: nodesRaw.map((row, index) => normalizeNode(row, index)),
  };

  if (normalizedInput.frequency_mhz <= 0) throw new Error("input.frequency_mhz must be greater than 0.");
  if (normalizedInput.nodes.length > MAX_NODES) throw new Error(`input.nodes exceeds maximum of ${MAX_NODES} sites.`);

  return { calculation: "link_budget", input: normalizedInput };
};

export const haversineKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = toRadians(a.lat);
  const lon1 = toRadians(a.lon);
  const lat2 = toRadians(b.lat);
  const lon2 = toRadians(b.lon);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * (2 * Math.asin(Math.sqrt(hav)));
};

export const findEndpointNodes = (payload: CalculationRequest): { fromNode: NodeInput; toNode: NodeInput } => {
  const nodesByName = new Map<string, NodeInput>(payload.input.nodes.map((node) => [node.name.trim().toLowerCase(), node]));
  const fromNode = nodesByName.get(payload.input.from_site.trim().toLowerCase());
  if (!fromNode) throw new Error(`Site not found: ${payload.input.from_site}`);
  const toNode = nodesByName.get(payload.input.to_site.trim().toLowerCase());
  if (!toNode) throw new Error(`Site not found: ${payload.input.to_site}`);
  return { fromNode, toNode };
};

export const toSitesAndLink = (
  payload: CalculationRequest,
  fromGroundM: number,
  toGroundM: number,
): { fromSite: Site; toSite: Site; link: Link } => {
  const { fromNode, toNode } = findEndpointNodes(payload);
  const fromSite: Site = {
    id: "from",
    name: fromNode.name,
    position: { lat: fromNode.lat, lon: fromNode.lon },
    groundElevationM: fromGroundM,
    antennaHeightM: fromNode.antenna_height_m ?? 2,
    txPowerDbm: fromNode.tx_power_dbm,
    txGainDbi: fromNode.tx_gain_dbi,
    rxGainDbi: fromNode.rx_gain_dbi,
    cableLossDb: fromNode.cable_loss_db,
    antennaMode: fromNode.antenna_mode,
    antennaAzimuthDeg: fromNode.antenna_azimuth_deg,
    antennaTiltDeg: fromNode.antenna_tilt_deg,
    antennaHorizontalBeamwidthDeg: fromNode.antenna_horizontal_beamwidth_deg,
    antennaVerticalBeamwidthDeg: fromNode.antenna_vertical_beamwidth_deg,
    antennaMaxAttenuationDb: fromNode.antenna_max_attenuation_db,
  };
  const toSite: Site = {
    id: "to",
    name: toNode.name,
    position: { lat: toNode.lat, lon: toNode.lon },
    groundElevationM: toGroundM,
    antennaHeightM: toNode.antenna_height_m ?? 2,
    txPowerDbm: toNode.tx_power_dbm,
    txGainDbi: toNode.tx_gain_dbi,
    rxGainDbi: toNode.rx_gain_dbi,
    cableLossDb: toNode.cable_loss_db,
    antennaMode: toNode.antenna_mode,
    antennaAzimuthDeg: toNode.antenna_azimuth_deg,
    antennaTiltDeg: toNode.antenna_tilt_deg,
    antennaHorizontalBeamwidthDeg: toNode.antenna_horizontal_beamwidth_deg,
    antennaVerticalBeamwidthDeg: toNode.antenna_vertical_beamwidth_deg,
    antennaMaxAttenuationDb: toNode.antenna_max_attenuation_db,
  };
  const link: Link = {
    id: "api-link",
    fromSiteId: fromSite.id,
    toSiteId: toSite.id,
    frequencyMHz: payload.input.frequency_mhz,
    txPowerDbm: fromNode.tx_power_dbm,
    txGainDbi: fromNode.tx_gain_dbi,
    rxGainDbi: toNode.rx_gain_dbi,
    cableLossDb: fromNode.cable_loss_db,
  };
  return { fromSite, toSite, link };
};

export const effectiveApiLinkGains = (
  payload: CalculationRequest,
  fromGroundM: number,
  toGroundM: number,
): { txGainDbi: number; rxGainDbi: number } => {
  const { fromSite, toSite, link } = toSitesAndLink(payload, fromGroundM, toGroundM);
  return {
    txGainDbi: effectiveGainTowardSiteDbi(link.txGainDbi ?? fromSite.txGainDbi, fromSite, toSite),
    rxGainDbi: effectiveGainTowardSiteDbi(link.rxGainDbi ?? toSite.rxGainDbi, toSite, fromSite),
  };
};

export const estimateSampleCount = (distanceKm: number): number => {
  const byDistance = Math.ceil(distanceKm / 0.5);
  return Math.max(24, Math.min(MAX_SAMPLES, byDistance));
};

export const estimateSyncSampleCount = (distanceKm: number): number => {
  const byDistance = Math.ceil(distanceKm / 0.75);
  return Math.max(24, Math.min(MAX_SYNC_TERRAIN_SAMPLES, byDistance));
};
