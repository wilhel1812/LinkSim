import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Link, ProfilePoint, Site, SrtmTile } from "../types/radio";

const { analyzeLinkMock, sampleSrtmElevationMock } = vi.hoisted(() => ({
  analyzeLinkMock: vi.fn(),
  sampleSrtmElevationMock: vi.fn(),
}));

vi.mock("./propagation", () => ({ analyzeLink: analyzeLinkMock }));
vi.mock("./srtm", () => ({ sampleSrtmElevation: sampleSrtmElevationMock }));

import { buildPathLeaderboardCandidate, submitPathLeaderboardCandidate, createPathLeaderboardSubmitter } from "./pathLeaderboard";
import { defaultPropagationEnvironment } from "./propagationEnvironment";

const fromSite: Site = {
  id: "site-a",
  name: "Alpha",
  position: { lat: 60, lon: 10 },
  groundElevationM: 100,
  antennaHeightM: 10,
  txPowerDbm: 22,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
};

const toSite: Site = {
  ...fromSite,
  id: "site-b",
  name: "Beta",
  position: { lat: 60.2, lon: 10.3 },
};

const link: Link = {
  id: "link-1",
  fromSiteId: fromSite.id,
  toSiteId: toSite.id,
  frequencyMHz: 868,
};

const profile: ProfilePoint[] = [
  { distanceKm: 0, lat: 60, lon: 10, terrainM: 100, losM: 110, fresnelTopM: 120, fresnelBottomM: 100 },
  { distanceKm: 10, lat: 60.1, lon: 10.1, terrainM: 120, losM: 130, fresnelTopM: 140, fresnelBottomM: 120 },
  { distanceKm: 20, lat: 60.2, lon: 10.3, terrainM: 110, losM: 120, fresnelTopM: 130, fresnelBottomM: 110 },
];

const tile = {
  key: "N60E010",
  latStart: 60,
  lonStart: 10,
  size: 1201,
  arcSecondSpacing: 3,
  elevations: new Int16Array(1),
  sourceId: "copernicus30",
} satisfies SrtmTile;

const baseInput = () => ({
  simulationId: "sim-1",
  simulationUpdatedAt: "2026-05-16T12:00:00.000Z",
  fromSite,
  toSite,
  link,
  profile,
  srtmTiles: [tile],
  requiredTerrainTileKeys: [tile.key],
  isTerrainFetching: false,
  isTerrainRecommending: false,
  hasDragPreview: false,
  terrainDataset: "copernicus30",
  propagationModel: "ITM" as const,
  propagationEnvironment: defaultPropagationEnvironment(),
  rxSensitivityTargetDbm: -120,
  environmentLossDb: 2,
});

beforeEach(() => {
  vi.clearAllMocks();
  sampleSrtmElevationMock.mockReturnValue(100);
  analyzeLinkMock.mockReturnValue({
    distanceKm: 42.42,
    rxLevelDbm: -100,
    terrainObstructed: true,
  });
});

describe("path leaderboard candidate gate", () => {
  it("builds a terrain-backed passing candidate when terrain is complete", () => {
    const result = buildPathLeaderboardCandidate(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate).toMatchObject({
      simulationId: "sim-1",
      fromSiteId: "site-a",
      toSiteId: "site-b",
      distanceKm: 42.42,
      rxAfterEnvLossDbm: -102,
      rxMarginDb: 18,
      terrainObstructed: true,
      terrainDataset: "copernicus30",
    });
    expect(result.candidate.terrainTileSignature).toBeTruthy();
  });

  it("allows unsaved selected site pairs by omitting the synthetic link id", () => {
    const result = buildPathLeaderboardCandidate({
      ...baseInput(),
      link: {
        ...link,
        id: "__selection__",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.linkId).toBeNull();
  });

  it("waits while terrain is still loading", () => {
    expect(buildPathLeaderboardCandidate({ ...baseInput(), isTerrainFetching: true })).toEqual({
      ok: false,
      reason: "terrain-loading",
    });
  });

  it("requires all simulation terrain tiles to be loaded", () => {
    expect(buildPathLeaderboardCandidate({ ...baseInput(), requiredTerrainTileKeys: [tile.key, "N61E010"] })).toEqual({
      ok: false,
      reason: "missing-simulation-terrain",
    });
  });

  it("requires every profile sample to resolve real terrain", () => {
    sampleSrtmElevationMock.mockReturnValueOnce(100).mockReturnValueOnce(null);
    expect(buildPathLeaderboardCandidate(baseInput())).toEqual({
      ok: false,
      reason: "missing-profile-terrain",
    });
  });

  it("skips failing paths and transient drag previews", () => {
    analyzeLinkMock.mockReturnValueOnce({ distanceKm: 42.42, rxLevelDbm: -130, terrainObstructed: false });
    expect(buildPathLeaderboardCandidate(baseInput())).toEqual({ ok: false, reason: "not-passing" });
    expect(buildPathLeaderboardCandidate({ ...baseInput(), hasDragPreview: true })).toEqual({
      ok: false,
      reason: "preview-active",
    });
  });
});

describe("path leaderboard submission", () => {
  const candidate = () => {
    const result = buildPathLeaderboardCandidate(baseInput());
    if (!result.ok) throw new Error("fixture");
    return result.candidate;
  };
  it("returns stored/skipped outcomes and distinguishes unexpected HTTP and transport failures", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, stored: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, stored: false, reason: "stale_simulation" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, stored: false, reason: "private_simulation" })))
      .mockResolvedValueOnce(new Response("internal", { status: 503 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await submitPathLeaderboardCandidate(candidate())).toEqual({ status: "stored" });
      expect(await submitPathLeaderboardCandidate(candidate())).toEqual({ status: "skipped", reason: "stale_simulation" });
      expect(await submitPathLeaderboardCandidate(candidate())).toEqual({ status: "skipped", reason: "private_simulation" });
      expect(await submitPathLeaderboardCandidate(candidate())).toEqual({ status: "retryable" });
      expect(await submitPathLeaderboardCandidate(candidate())).toEqual({ status: "retryable" });
    } finally { vi.unstubAllGlobals(); }
  });
  it("deduplicates in-flight and terminal outcomes but allows two bounded transient attempts", async () => {
    let finish!: (value: { status: "stored" }) => void;
    const submit = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue({ status: "retryable" });
    let now = 0;
    const run = createPathLeaderboardSubmitter(submit, () => now);
    const first = run("stored", candidate());
    await run("stored", candidate()); expect(submit).toHaveBeenCalledTimes(1);
    finish({ status: "stored" }); await first;
    await run("stored", candidate()); expect(submit).toHaveBeenCalledTimes(1);
    await run("retry", candidate()); expect(submit).toHaveBeenCalledTimes(2);
    await run("retry", candidate()); expect(submit).toHaveBeenCalledTimes(2);
    now = 6000; await run("retry", candidate()); expect(submit).toHaveBeenCalledTimes(3);
    now = 12000; await run("retry", candidate()); expect(submit).toHaveBeenCalledTimes(3);
  });
  it("never repeatedly submits an expected rejection", async () => {
    const submit = vi.fn().mockResolvedValue({ status: "skipped", reason: "stale_simulation" });
    const run = createPathLeaderboardSubmitter(submit);
    await run("stale", candidate()); await run("stale", candidate());
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

it("does not send an auto-generated analysis link as a saved Path id", () => {
  const result = buildPathLeaderboardCandidate({ ...baseInput(), link: { ...link, id: "__auto__" } });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.candidate.linkId).toBeNull();
});
