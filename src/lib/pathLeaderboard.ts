import { analyzeLink } from "./propagation";
import { sampleSrtmElevation } from "./srtm";
import type { Link, ProfilePoint, PropagationEnvironment, PropagationModel, Site, SrtmTile } from "../types/radio";

export type PathLeaderboardCandidate = {
  simulationId: string;
  simulationUpdatedAt: string;
  fromSiteId: string;
  toSiteId: string;
  linkId?: string | null;
  distanceKm: number;
  rxAfterEnvLossDbm: number;
  rxMarginDb: number;
  terrainObstructed: boolean;
  terrainDataset: string;
  terrainTileSignature: string;
};

export type BuildPathLeaderboardCandidateInput = {
  simulationId: string;
  simulationUpdatedAt: string;
  fromSite: Site | null;
  toSite: Site | null;
  link: Link | null;
  profile: ProfilePoint[];
  srtmTiles: SrtmTile[];
  requiredTerrainTileKeys: string[];
  isTerrainFetching: boolean;
  isTerrainRecommending: boolean;
  hasDragPreview: boolean;
  terrainDataset: string;
  propagationModel: PropagationModel;
  propagationEnvironment: PropagationEnvironment;
  rxSensitivityTargetDbm: number;
  environmentLossDb: number;
};

export type BuildPathLeaderboardCandidateResult =
  | { ok: true; candidate: PathLeaderboardCandidate; signature: string }
  | { ok: false; reason: string };

const FNV_OFFSET_BASIS = 2166136261;

const updateFnvHash = (hash: number, input: string): number => {
  let next = hash;
  for (let index = 0; index < input.length; index += 1) {
    next ^= input.charCodeAt(index);
    next = Math.imul(next, 16777619) >>> 0;
  }
  return next;
};

const hashStrings = (values: string[]): string => {
  let hash = FNV_OFFSET_BASIS;
  for (const value of values) hash = updateFnvHash(hash, value);
  return hash.toString(16);
};

export const terrainTileSignatureForKeys = (srtmTiles: SrtmTile[], requiredTerrainTileKeys: string[]): string => {
  const required = new Set(requiredTerrainTileKeys);
  const parts = srtmTiles
    .filter((tile) => required.has(tile.key))
    .map((tile) => `${tile.key}:${tile.sourceId ?? tile.sourceKind ?? "unknown"}:${tile.width ?? tile.size}`)
    .sort();
  return parts.length ? hashStrings(parts) : "";
};

export const profileHasCompleteTerrain = (profile: ProfilePoint[], srtmTiles: SrtmTile[]): boolean =>
  profile.length >= 2 && profile.every((point) => sampleSrtmElevation(srtmTiles, point.lat, point.lon) !== null);

export const buildPathLeaderboardCandidate = (
  input: BuildPathLeaderboardCandidateInput,
): BuildPathLeaderboardCandidateResult => {
  const {
    simulationId,
    simulationUpdatedAt,
    fromSite,
    toSite,
    link,
    profile,
    srtmTiles,
    requiredTerrainTileKeys,
    isTerrainFetching,
    isTerrainRecommending,
    hasDragPreview,
    terrainDataset,
    propagationModel,
    propagationEnvironment,
    rxSensitivityTargetDbm,
    environmentLossDb,
  } = input;

  if (!simulationId || !simulationUpdatedAt) return { ok: false, reason: "missing-simulation" };
  if (!fromSite || !toSite || !link) return { ok: false, reason: "missing-path" };
  if (hasDragPreview) return { ok: false, reason: "preview-active" };
  if (isTerrainFetching || isTerrainRecommending) return { ok: false, reason: "terrain-loading" };

  const loadedTileKeys = new Set(srtmTiles.map((tile) => tile.key));
  if (!requiredTerrainTileKeys.length || requiredTerrainTileKeys.some((key) => !loadedTileKeys.has(key))) {
    return { ok: false, reason: "missing-simulation-terrain" };
  }
  if (!profileHasCompleteTerrain(profile, srtmTiles)) return { ok: false, reason: "missing-profile-terrain" };

  const terrainSampler = ({ lat, lon }: { lat: number; lon: number }) => sampleSrtmElevation(srtmTiles, lat, lon);
  const analysis = analyzeLink(link, fromSite, toSite, propagationModel, terrainSampler, {
    terrainSamples: Math.max(48, profile.length),
    environment: propagationEnvironment,
  });
  const rxAfterEnvLossDbm = analysis.rxLevelDbm - environmentLossDb;
  const rxMarginDb = rxAfterEnvLossDbm - rxSensitivityTargetDbm;
  if (rxMarginDb < 0) return { ok: false, reason: "not-passing" };

  const terrainTileSignature = terrainTileSignatureForKeys(srtmTiles, requiredTerrainTileKeys);
  if (!terrainTileSignature) return { ok: false, reason: "missing-terrain-signature" };

  const fromSiteId = fromSite.id;
  const toSiteId = toSite.id;
  const canonicalPathKey = [fromSiteId, toSiteId].sort((a, b) => a.localeCompare(b)).join("~");
  const candidate: PathLeaderboardCandidate = {
    simulationId,
    simulationUpdatedAt,
    fromSiteId,
    toSiteId,
    linkId: link.id,
    distanceKm: analysis.distanceKm,
    rxAfterEnvLossDbm,
    rxMarginDb,
    terrainObstructed: analysis.terrainObstructed,
    terrainDataset,
    terrainTileSignature,
  };
  const signature = [
    simulationId,
    simulationUpdatedAt,
    canonicalPathKey,
    terrainTileSignature,
    analysis.distanceKm.toFixed(3),
    rxMarginDb.toFixed(1),
  ].join("|");
  return { ok: true, candidate, signature };
};

export const submitPathLeaderboardCandidate = async (candidate: PathLeaderboardCandidate): Promise<void> => {
  await fetch("/api/stats/path-leaderboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(candidate),
  });
};
