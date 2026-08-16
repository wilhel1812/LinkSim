import type { Link, Site } from "../types/radio";
import { isCompatiblePersistedCoverageResolution, normalizeCoverageResolution } from "./coverageResolution";
import { migrateSitesAndLinksToSiteRadioDefaults, withSiteRadioDefaults } from "./linkRadio";
import { validatePropagationEnvironment } from "./propagationEnvironmentValidation";
import { isCompatiblePersistedTerrainDataset, normalizeTerrainDataset } from "./terrainDataset";

export const LIBRARY_REQUEST_MAX_BYTES = 2 * 1024 * 1024;
export const LIBRARY_JSON_MAX_DEPTH = 20;
export const LIBRARY_BATCH_MAX_RECORDS = 20;
export const LIBRARY_READ_PAGE_MAX_RECORDS = LIBRARY_BATCH_MAX_RECORDS;
export const LIBRARY_READ_RESPONSE_MAX_BYTES = LIBRARY_REQUEST_MAX_BYTES;
export const LIBRARY_READ_CURSOR_MAX_CHARS = 1024;
export const LIBRARY_SITE_MAX_BYTES = 32 * 1024;
export const LIBRARY_SIMULATION_MAX_BYTES = 256 * 1024;
export const LIBRARY_MAX_GRANTS = 100;
export const LIBRARY_MAX_SITES_PER_USER = 500;
export const LIBRARY_MAX_SIMULATIONS_PER_USER = 100;
export const LIBRARY_MAX_PUBLIC_SITES_PER_USER = 100;
export const LIBRARY_MAX_PUBLIC_SIMULATIONS_PER_USER = 25;
export const SIMULATION_MAX_SITES = 250;
export const SIMULATION_MAX_PATHS = 1000;

const MAX_ID_LENGTH = 128;
const textEncoder = new TextEncoder();

export class LibraryValidationError extends Error {
  readonly status = 422;
  readonly code = "invalid_library_payload";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const assertId: (value: unknown, label: string) => asserts value is string = (value, label) => {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > MAX_ID_LENGTH) {
    throw new LibraryValidationError(`${label} must be a non-empty string no longer than ${MAX_ID_LENGTH} characters.`);
  }
};

const assertName: (value: unknown, label: string) => asserts value is string = (value, label) => {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) {
    throw new LibraryValidationError(`${label} must be a non-empty string.`);
  }
};

const assertFiniteIfPresent = (record: Record<string, unknown>, keys: string[], label: string): void => {
  for (const key of keys) {
    if (record[key] !== undefined && (typeof record[key] !== "number" || !Number.isFinite(record[key]))) {
      throw new LibraryValidationError(`${label} ${key} must be a finite number.`);
    }
  }
};

const assertFiniteRequired = (record: Record<string, unknown>, keys: string[], label: string): void => {
  for (const key of keys) {
    if (typeof record[key] !== "number" || !Number.isFinite(record[key])) {
      throw new LibraryValidationError(`${label} ${key} must be a finite number.`);
    }
  }
};

const assertPosition = (value: unknown, label: string): void => {
  if (!isRecord(value)
    || typeof value.lat !== "number"
    || !Number.isFinite(value.lat)
    || value.lat < -90
    || value.lat > 90
    || typeof value.lon !== "number"
    || !Number.isFinite(value.lon)
    || value.lon < -180
    || value.lon > 180) {
    throw new LibraryValidationError(`${label} position must contain valid latitude and longitude.`);
  }
};

const assertGrants = (value: unknown): void => {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new LibraryValidationError("sharedWith must be an array.");
  if (value.length > LIBRARY_MAX_GRANTS) {
    throw new LibraryValidationError(`A Library record may contain at most ${LIBRARY_MAX_GRANTS} grants.`);
  }
  for (const grant of value) {
    if (!isRecord(grant)) throw new LibraryValidationError("Each Library grant must be an object.");
    assertId(grant.userId, "Grant user ID");
    if (!new Set(["viewer", "editor", "admin"]).has(String(grant.role))) {
      throw new LibraryValidationError("Grant role must be viewer, editor, or admin.");
    }
  }
};

const assertCommonRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new LibraryValidationError(`${label} must be an object.`);
  assertId(value.id, `${label} ID`);
  assertName(value.name, `${label} name`);
  if (value.visibility !== undefined && !new Set(["private", "public", "shared"]).has(String(value.visibility))) {
    throw new LibraryValidationError(`${label} visibility must be private, public, or shared.`);
  }
  assertGrants(value.sharedWith);
  return value;
};

const assertNestedNamedRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new LibraryValidationError(`${label} must be an object.`);
  assertId(value.id, `${label} ID`);
  assertName(value.name, `${label} name`);
  return value;
};

const encodedBytes = (value: unknown): number => textEncoder.encode(JSON.stringify(value)).byteLength;

const SITE_RADIO_KEYS = ["txPowerDbm", "txGainDbi", "rxGainDbi", "cableLossDb"] as const;
const LINK_RADIO_KEYS = SITE_RADIO_KEYS;

const hasOnlyMissingOrFiniteRadioValues = (
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean => keys.every((key) => record[key] === undefined
  || (typeof record[key] === "number" && Number.isFinite(record[key])));

const normalizeSiteCompatibility = (value: unknown): unknown => {
  if (!isRecord(value)
    || !SITE_RADIO_KEYS.some((key) => value[key] === undefined)
    || !hasOnlyMissingOrFiniteRadioValues(value, SITE_RADIO_KEYS)) return value;
  return withSiteRadioDefaults(value as Site);
};

const normalizeSimulationCompatibility = (value: unknown): unknown => {
  if (!isRecord(value) || !isRecord(value.snapshot)) return value;
  const snapshot = { ...value.snapshot };
  const terrainDataset = snapshot.terrainDataset;
  let changed = false;

  if (terrainDataset !== undefined && isCompatiblePersistedTerrainDataset(terrainDataset)) {
    snapshot.terrainDataset = normalizeTerrainDataset(terrainDataset);
    changed = snapshot.terrainDataset !== terrainDataset;
  }

  const coverageResolution = snapshot.selectedCoverageResolution;
  if (coverageResolution !== undefined && isCompatiblePersistedCoverageResolution(coverageResolution)) {
    snapshot.selectedCoverageResolution = normalizeCoverageResolution(coverageResolution);
    changed = changed || snapshot.selectedCoverageResolution !== coverageResolution;
  }

  if (Array.isArray(snapshot.sites)
    && snapshot.sites.every(isRecord)
    && Array.isArray(snapshot.links)
    && snapshot.links.every(isRecord)
    && snapshot.sites.some((site) => SITE_RADIO_KEYS.some((key) => site[key] === undefined))
    && snapshot.sites.every((site) => hasOnlyMissingOrFiniteRadioValues(site, SITE_RADIO_KEYS))
    && snapshot.links.every((link) => hasOnlyMissingOrFiniteRadioValues(link, LINK_RADIO_KEYS))) {
    const migrated = migrateSitesAndLinksToSiteRadioDefaults(
      snapshot.sites as Site[],
      snapshot.links as Link[],
    );
    snapshot.sites = migrated.sites;
    snapshot.links = migrated.links;
    changed = true;
  }

  if (!changed) return value;
  return {
    ...value,
    snapshot,
  };
};

const assertRequiredDateString = (value: unknown, label: string): void => {
  if (typeof value !== "string" || value.trim().length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new LibraryValidationError(`${label} must be a valid date string.`);
  }
};

const assertEnumIfPresent = (value: unknown, allowed: readonly string[], label: string): void => {
  if (value !== undefined && (typeof value !== "string" || !allowed.includes(value))) {
    throw new LibraryValidationError(`${label} is not supported.`);
  }
};

const assertSite = (value: unknown, nested = false): void => {
  const site = nested
    ? (() => {
        if (!isRecord(value)) throw new LibraryValidationError("Site must be an object.");
        assertId(value.id, "Site ID");
        assertName(value.name, "Site name");
        return value;
      })()
    : assertCommonRecord(value, "Site");
  if (!nested) assertRequiredDateString(site.createdAt, "Site createdAt");
  assertEnumIfPresent(site.antennaMode, ["omnidirectional", "directional"], "Site antenna mode");
  assertEnumIfPresent(site.antennaTargetDetachedReason, ["target-deleted"], "Site antenna target detached reason");
  assertPosition(site.position, "Site");
  assertFiniteRequired(site, [
    "groundElevationM",
    "antennaHeightM",
    "txPowerDbm",
    "txGainDbi",
    "rxGainDbi",
    "cableLossDb",
  ], "Site");
  assertFiniteIfPresent(site, [
    "antennaAzimuthDeg",
    "antennaTiltDeg",
    "antennaHorizontalBeamwidthDeg",
    "antennaVerticalBeamwidthDeg",
    "antennaMaxAttenuationDb",
  ], "Site");
  if (!nested && encodedBytes(site) > LIBRARY_SITE_MAX_BYTES) {
    throw new LibraryValidationError(`Site record exceeds ${LIBRARY_SITE_MAX_BYTES} bytes.`);
  }
};

const assertPath = (value: unknown): void => {
  if (!isRecord(value)) throw new LibraryValidationError("Path must be an object.");
  assertId(value.id, "Path ID");
  assertId(value.fromSiteId, "Path fromSiteId");
  assertId(value.toSiteId, "Path toSiteId");
  assertFiniteRequired(value, ["frequencyMHz"], "Path");
  assertFiniteIfPresent(value, ["txPowerDbm", "txGainDbi", "rxGainDbi", "cableLossDb"], "Path");
};

const assertRadioSystem = (value: unknown): void => {
  const system = assertNestedNamedRecord(value, "Radio System");
  assertFiniteRequired(system, [
    "txPowerDbm",
    "txGainDbi",
    "rxGainDbi",
    "cableLossDb",
    "antennaHeightM",
  ], "Radio System");
};

const assertNetwork = (value: unknown): void => {
  const network = assertNestedNamedRecord(value, "Network");
  assertFiniteRequired(network, ["frequencyMHz", "bandwidthKhz", "spreadFactor", "codingRate"], "Network");
  assertFiniteIfPresent(network, ["frequencyOverrideMHz"], "Network");
  if (!Array.isArray(network.memberships)) throw new LibraryValidationError("Network memberships must be an array.");
  for (const membership of network.memberships) {
    if (!isRecord(membership)) throw new LibraryValidationError("Network membership must be an object.");
    assertId(membership.siteId, "Network membership Site ID");
    assertId(membership.systemId, "Network membership Radio System ID");
  }
};

const assertSimulation = (value: unknown): void => {
  const simulation = assertCommonRecord(value, "Simulation");
  assertRequiredDateString(simulation.updatedAt, "Simulation updatedAt");
  assertEnumIfPresent(simulation.status, ["active", "deleted"], "Simulation status");
  if (!isRecord(simulation.snapshot)) throw new LibraryValidationError("Simulation snapshot must be an object.");
  const { snapshot } = simulation;
  assertEnumIfPresent(snapshot.propagationModel, ["ITM"], "Simulation propagation model");
  assertEnumIfPresent(snapshot.selectedCoverageResolution, ["24", "42", "84", "168"], "Simulation coverage resolution");
  assertEnumIfPresent(snapshot.selectedOverlayRadiusOption, ["20", "50", "100", "200"], "Simulation overlay radius");
  assertEnumIfPresent(snapshot.terrainDataset, ["copernicus30"], "Simulation terrain dataset");
  assertEnumIfPresent(snapshot.linkColorMode, ["manual", "auto"], "Simulation Path color mode");
  if (!Array.isArray(snapshot.sites)) throw new LibraryValidationError("Simulation snapshot Sites must be an array.");
  if (!Array.isArray(snapshot.links)) throw new LibraryValidationError("Simulation snapshot Paths must be an array.");
  if (snapshot.sites.length > SIMULATION_MAX_SITES) {
    throw new LibraryValidationError(`Simulation may contain at most ${SIMULATION_MAX_SITES} Sites.`);
  }
  if (snapshot.links.length > SIMULATION_MAX_PATHS) {
    throw new LibraryValidationError(`Simulation may contain at most ${SIMULATION_MAX_PATHS} Paths.`);
  }
  snapshot.sites.forEach((site) => assertSite(site, true));
  snapshot.links.forEach(assertPath);
  const systems = snapshot.systems === undefined ? [] : snapshot.systems;
  const networks = snapshot.networks === undefined ? [] : snapshot.networks;
  if (!Array.isArray(systems)) throw new LibraryValidationError("Simulation snapshot systems must be an array.");
  if (!Array.isArray(networks)) throw new LibraryValidationError("Simulation snapshot networks must be an array.");
  systems.forEach(assertRadioSystem);
  networks.forEach(assertNetwork);
  if (snapshot.propagationEnvironment !== undefined) {
    try {
      validatePropagationEnvironment(snapshot.propagationEnvironment);
    } catch (error) {
      throw new LibraryValidationError(
        `Simulation propagation environment is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const siteIds = new Set(snapshot.sites.map((site) => isRecord(site) ? site.id : undefined));
  const systemIds = new Set(systems.map((system) => isRecord(system) ? system.id : undefined));
  if (siteIds.size !== snapshot.sites.length) throw new LibraryValidationError("Simulation contains duplicate Site IDs.");
  if (systemIds.size !== systems.length) throw new LibraryValidationError("Simulation contains duplicate Radio System IDs.");
  const pathIds = new Set(snapshot.links.map((path) => isRecord(path) ? path.id : undefined));
  if (pathIds.size !== snapshot.links.length) throw new LibraryValidationError("Simulation contains duplicate Path IDs.");
  for (const path of snapshot.links) {
    const record = path as Record<string, unknown>;
    if (!siteIds.has(record.fromSiteId) || !siteIds.has(record.toSiteId)) {
      throw new LibraryValidationError("Simulation Path references an unknown Site ID.");
    }
  }
  for (const network of networks) {
    const record = network as Record<string, unknown>;
    for (const membership of record.memberships as Record<string, unknown>[]) {
      if (!siteIds.has(membership.siteId) || !systemIds.has(membership.systemId)) {
        throw new LibraryValidationError("Simulation Network membership references an unknown ID.");
      }
    }
  }
  if (encodedBytes(simulation) > LIBRARY_SIMULATION_MAX_BYTES) {
    throw new LibraryValidationError(`Simulation record exceeds ${LIBRARY_SIMULATION_MAX_BYTES} bytes.`);
  }
};

export type ValidatedLibraryPayload = {
  siteLibrary: Record<string, unknown>[];
  simulationPresets: Record<string, unknown>[];
};

export const validateLibraryPayload = (value: unknown): ValidatedLibraryPayload => {
  if (!isRecord(value)) throw new LibraryValidationError("Library payload must be an object.");
  const siteLibrary = value.siteLibrary ?? [];
  const simulationPresets = value.simulationPresets ?? [];
  if (!Array.isArray(siteLibrary) || !Array.isArray(simulationPresets)) {
    throw new LibraryValidationError("Library collections must be arrays.");
  }
  if (siteLibrary.length + simulationPresets.length > LIBRARY_BATCH_MAX_RECORDS) {
    throw new LibraryValidationError(`Library request may contain at most ${LIBRARY_BATCH_MAX_RECORDS} records.`);
  }
  if (new Set(siteLibrary.map((site) => isRecord(site) ? site.id : undefined)).size !== siteLibrary.length) {
    throw new LibraryValidationError("Library request contains duplicate Site IDs.");
  }
  const normalizedSiteLibrary = siteLibrary.map(normalizeSiteCompatibility);
  const normalizedSimulationPresets = simulationPresets.map(normalizeSimulationCompatibility);
  if (new Set(normalizedSimulationPresets.map((simulation) => isRecord(simulation) ? simulation.id : undefined)).size !== normalizedSimulationPresets.length) {
    throw new LibraryValidationError("Library request contains duplicate Simulation IDs.");
  }
  normalizedSiteLibrary.forEach((site) => assertSite(site));
  normalizedSimulationPresets.forEach(assertSimulation);
  return {
    siteLibrary: normalizedSiteLibrary as Record<string, unknown>[],
    simulationPresets: normalizedSimulationPresets as Record<string, unknown>[],
  };
};

export type RejectedLibraryRecord = {
  kind: "site" | "simulation";
  id: string | null;
  reason: string;
  value: unknown;
};

export type PartitionedLibraryPayload = ValidatedLibraryPayload & {
  rejected: RejectedLibraryRecord[];
};

const candidateId = (value: unknown): string | null => {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return null;
  return value.id.trim();
};

export const partitionLibraryPayload = (value: unknown): PartitionedLibraryPayload => {
  const raw = isRecord(value) ? value : {};
  const siteCandidates = Array.isArray(raw.siteLibrary) ? raw.siteLibrary : [];
  const simulationCandidates = Array.isArray(raw.simulationPresets) ? raw.simulationPresets : [];
  const rejected: RejectedLibraryRecord[] = [];
  if (raw.siteLibrary !== undefined && !Array.isArray(raw.siteLibrary)) {
    rejected.push({ kind: "site", id: null, reason: "Site Library collection must be an array.", value: raw.siteLibrary });
  }
  if (raw.simulationPresets !== undefined && !Array.isArray(raw.simulationPresets)) {
    rejected.push({ kind: "simulation", id: null, reason: "Simulation Library collection must be an array.", value: raw.simulationPresets });
  }
  const duplicateIds = (records: unknown[]): Set<string> => {
    const counts = new Map<string, number>();
    for (const record of records) {
      const id = candidateId(record);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
  };
  const partition = (
    kind: "site" | "simulation",
    records: unknown[],
    duplicates: Set<string>,
  ): Record<string, unknown>[] => {
    const accepted: Record<string, unknown>[] = [];
    for (const record of records) {
      const id = candidateId(record);
      if (id && duplicates.has(id)) {
        rejected.push({ kind, id, reason: `Duplicate ${kind} ID.`, value: record });
        continue;
      }
      try {
        const validated = validateLibraryPayload({
          siteLibrary: kind === "site" ? [record] : [],
          simulationPresets: kind === "simulation" ? [record] : [],
        });
        accepted.push((kind === "site" ? validated.siteLibrary : validated.simulationPresets)[0]);
      } catch (error) {
        rejected.push({
          kind,
          id,
          reason: error instanceof Error ? error.message : String(error),
          value: record,
        });
      }
    }
    return accepted;
  };
  return {
    siteLibrary: partition("site", siteCandidates, duplicateIds(siteCandidates)),
    simulationPresets: partition("simulation", simulationCandidates, duplicateIds(simulationCandidates)),
    rejected,
  };
};
