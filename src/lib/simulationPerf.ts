type CoveragePerfRecord = {
  runId: string;
  signature: string;
  durationMs: number;
  sampleCount: number;
  gridSize: number;
  effectiveRadiusKm: number;
};

type OverlayPerfRecord = {
  runId: string;
  mode: "heatmap" | "contours" | "passfail" | "relay" | "terrain";
  buildDurationMs: number;
  encodeDurationMs: number;
  width: number;
  height: number;
  pixelCount: number;
  gridSize: number;
  effectiveRadiusKm: number;
};

type PendingRunPerf = {
  coverage?: CoveragePerfRecord;
  overlay?: OverlayPerfRecord;
  logged: boolean;
};

const isPrivateIpv4Host = (host: string): boolean =>
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host) ||
  /^192\.168\.\d{1,3}\.\d{1,3}$/u.test(host) ||
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/u.test(host);

const localDiagnosticsHostName = (() => {
  if (typeof window === "undefined") return null;
  const locationLike = (window as Window & { location?: { hostname?: unknown } }).location;
  if (!locationLike || typeof locationLike.hostname !== "string") return null;
  return locationLike.hostname.toLowerCase();
})();

const isLocalDiagnosticsHost =
  localDiagnosticsHostName !== null &&
  (
    localDiagnosticsHostName === "localhost" ||
    localDiagnosticsHostName === "127.0.0.1" ||
    localDiagnosticsHostName === "::1" ||
    localDiagnosticsHostName.endsWith(".local") ||
    isPrivateIpv4Host(localDiagnosticsHostName)
  );

const inDevDiagnostics =
  typeof import.meta !== "undefined" &&
  (
    Boolean((import.meta as { env?: { DEV?: boolean; MODE?: string } }).env?.DEV) ||
    isLocalDiagnosticsHost
  ) &&
  (import.meta as { env?: { MODE?: string } }).env?.MODE !== "test";

const pendingByRun = new Map<string, PendingRunPerf>();

const round2 = (value: number): number => Math.round(value * 100) / 100;

const ensurePending = (runId: string): PendingRunPerf => {
  const existing = pendingByRun.get(runId);
  if (existing) return existing;
  const created: PendingRunPerf = { logged: false };
  pendingByRun.set(runId, created);
  if (pendingByRun.size > 100) {
    const oldest = pendingByRun.keys().next().value;
    if (typeof oldest === "string") pendingByRun.delete(oldest);
  }
  return created;
};

const maybeLogRun = (runId: string): void => {
  if (!inDevDiagnostics) return;
  const pending = pendingByRun.get(runId);
  if (!pending || pending.logged || !pending.coverage || !pending.overlay) return;

  pending.logged = true;
  console.info("[simulation-perf-run]", {
    runId,
    signature: pending.coverage.signature,
    coverageComputeMs: round2(pending.coverage.durationMs),
    overlayMode: pending.overlay.mode,
    overlayBuildMs: round2(pending.overlay.buildDurationMs),
    overlayEncodeMs: round2(pending.overlay.encodeDurationMs),
    sampleCount: pending.coverage.sampleCount,
    overlayPixelCount: pending.overlay.pixelCount,
    overlayWidth: pending.overlay.width,
    overlayHeight: pending.overlay.height,
    gridSize: pending.coverage.gridSize,
    overlayGridSize: pending.overlay.gridSize,
    effectiveRadiusKm: pending.coverage.effectiveRadiusKm,
    overlayRadiusKm: pending.overlay.effectiveRadiusKm,
  });

  pendingByRun.delete(runId);
};

export const recordSimulationCoveragePerf = (record: CoveragePerfRecord): void => {
  if (!inDevDiagnostics) return;
  const pending = ensurePending(record.runId);
  pending.coverage = record;
  maybeLogRun(record.runId);
};

export const recordSimulationOverlayPerf = (record: OverlayPerfRecord): void => {
  if (!inDevDiagnostics) return;
  const pending = ensurePending(record.runId);
  pending.overlay = record;
  maybeLogRun(record.runId);
};

export const recordSimulationRunCancelled = (payload: {
  runId: string;
  phase: "coverage" | "overlay";
  reason: string;
  signature?: string;
  mode?: OverlayPerfRecord["mode"];
}): void => {
  if (!inDevDiagnostics) return;
  console.info("[simulation-perf-cancelled]", payload);
  pendingByRun.delete(payload.runId);
};
