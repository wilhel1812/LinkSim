type OverlayPerfRecord = {
  runId: string;
  mode: "heatmap" | "contours" | "weakest" | "passfail" | "relay" | "mesh-extension" | "terrain";
  buildDurationMs: number;
  encodeDurationMs: number;
  width: number;
  height: number;
  pixelCount: number;
  gridSize: number;
  effectiveRadiusKm: number;
  evaluatedPaths?: number;
  refinedBlocks?: number;
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

const round2 = (value: number): number => Math.round(value * 100) / 100;

export const recordSimulationOverlayPerf = (record: OverlayPerfRecord): void => {
  if (!inDevDiagnostics) return;
  console.info("[simulation-perf-run]", {
    runId: record.runId,
    overlayMode: record.mode,
    overlayBuildMs: round2(record.buildDurationMs),
    overlayEncodeMs: round2(record.encodeDurationMs),
    logicalSampleCount: record.pixelCount,
    overlayPixelCount: record.pixelCount,
    overlayWidth: record.width,
    overlayHeight: record.height,
    gridSize: record.gridSize,
    effectiveRadiusKm: record.effectiveRadiusKm,
    evaluatedPaths: record.evaluatedPaths,
    refinedBlocks: record.refinedBlocks,
  });
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
};
