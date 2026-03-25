import type { Link, Site } from "../../src/types/radio";

export type NodeInput = {
  name: string;
  lat: number;
  lon: number;
  tx_power_dbm: number;
  tx_gain_dbi: number;
  rx_gain_dbi: number;
  cable_loss_db: number;
  antenna_height_m?: number;
};

export type LinkBudgetInput = {
  from_site: string;
  to_site: string;
  frequency_mhz: number;
  rx_target_dbm: number;
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
export const MAX_SYNC_DISTANCE_KM = 500;
export const MAX_TERRAIN_DISTANCE_KM = 2000;
export const MAX_SAMPLES = 500;

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
  return value.trim();
};

const normalizeBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const normalizeMode = (value: unknown): "fast" | "terrain" => (value === "terrain" ? "terrain" : "fast");

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
    antenna_height_m: typeof row.antenna_height_m === "number" ? row.antenna_height_m : 2,
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
    rx_target_dbm: typeof input.rx_target_dbm === "number" ? input.rx_target_dbm : -100,
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

export const estimateSampleCount = (distanceKm: number): number => {
  const byDistance = Math.ceil(distanceKm / 0.5);
  return Math.max(24, Math.min(MAX_SAMPLES, byDistance));
};
