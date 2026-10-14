import { analyzeLink } from "./propagation";
import { sampleSrtmElevation } from "./srtm";
import type { Link, ProfilePoint, PropagationEnvironment, PropagationModel, Site, SrtmTile } from "../types/radio";

import { isExpectedPathLeaderboardRejection, type PathLeaderboardCandidate } from "../types/pathLeaderboard";
export type { PathLeaderboardCandidate } from "../types/pathLeaderboard";

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

export const isPathLeaderboardReady = (state: {
  currentUser: { id: string } | null; authState: string; isOnline: boolean;
  libraryHydrated: boolean; syncPending: boolean; syncBusy: boolean; isInitializing: boolean; syncErrorMessage: string | null;
}): boolean => Boolean(state.currentUser?.id) && state.authState === "signed_in" &&
  state.libraryHydrated && state.isOnline && !state.syncPending && !state.syncBusy && !state.isInitializing && !state.syncErrorMessage;

const FNV_OFFSET_BASIS = 2166136261;
const SYNTHETIC_LINK_IDS = new Set(["__selection__", "__auto__"]);

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
    linkId: SYNTHETIC_LINK_IDS.has(link.id) ? null : link.id,
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

export type PathLeaderboardSubmissionOutcome =
  | { status: "stored" }
  | { status: "skipped"; reason: string }
  | { status: "retryable" };

export const submitPathLeaderboardCandidate = async (
  candidate: PathLeaderboardCandidate,
): Promise<PathLeaderboardSubmissionOutcome> => {
  try {
    const response = await fetch("/api/stats/path-leaderboard", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(candidate),
    });
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return { status: "retryable" };
    const result = body as Record<string, unknown>;
    if (response.ok && result.ok === true && result.stored === true) return { status: "stored" };
    if ((response.ok || response.status === 400) && result.stored === false &&
        ((result.ok === false && isExpectedPathLeaderboardRejection(result.reason)) ||
         (result.ok === true && result.reason === "private_simulation"))) {
      return { status: "skipped", reason: result.reason as string };
    }
    return { status: "retryable" };
  } catch {
    return { status: "retryable" };
  }
};

/** Deduplicate opportunistic submissions without marking failed requests successful.
 * Retry only on a later existing input/online event; never create a retry timer.
 */
export const createPathLeaderboardSubmitter = (
  submit = submitPathLeaderboardCandidate, now = Date.now,
) => {
  const attempts = new Map<string, { inFlight: boolean; terminal: boolean; count: number; retryAt: number }>();
  return async (signature: string, candidate: PathLeaderboardCandidate): Promise<void> => {
    let attempt = attempts.get(signature);
    if (attempt && (attempt.inFlight || attempt.terminal || attempt.count >= 2 || now() < attempt.retryAt)) return;
    if (!attempt) {
      if (attempts.size >= 48) {
        const evictable = [...attempts].find(([, entry]) => !entry.inFlight)?.[0];
        if (!evictable) return;
        attempts.delete(evictable);
      }
      attempt = { inFlight: false, terminal: false, count: 0, retryAt: 0 };
      attempts.set(signature, attempt);
    }
    attempt.inFlight = true;
    attempt.count += 1;
    try {
      const outcome = await submit(candidate);
      attempt.terminal = outcome.status !== "retryable";
    } catch {
      // A transient failure can be retried, but only within the same bounded lifecycle.
    } finally {
      attempt.inFlight = false;
      attempt.retryAt = now() + 5000;
    }
  };
};
