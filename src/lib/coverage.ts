import { haversineDistanceKm } from "./geo";
import { getPathLossByModel } from "./rfModels";
import { simulationAreaBoundsForSites } from "./simulationArea";
import { estimateTerrainExcessLossDb } from "./terrainLoss";
import type {
  Coordinates,
  CoverageMode,
  CoverageSample,
  Network,
  PropagationModel,
  RadioSystem,
  Site,
} from "../types/radio";

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

const midpoint = (sites: Site[]): { lat: number; lon: number } => ({
  lat: sites.reduce((sum, site) => sum + site.position.lat, 0) / sites.length,
  lon: sites.reduce((sum, site) => sum + site.position.lon, 0) / sites.length,
});

const interpolate = (a: number, b: number, t: number): number => a + (b - a) * t;

const evalRx = (
  sampleLat: number,
  sampleLon: number,
  rxSite: Site,
  txSystem: RadioSystem,
  frequencyMHz: number,
  model: PropagationModel,
  terrainSamples: number,
  terrainSampler?: (coordinates: Coordinates) => number | null,
): number => {
  const distanceKm = Math.max(
    0.001,
    haversineDistanceKm({ lat: sampleLat, lon: sampleLon }, rxSite.position),
  );
  const loss = getPathLossByModel(
    model,
    distanceKm,
    frequencyMHz,
    txSystem.antennaHeightM,
    rxSite.antennaHeightM,
  );
  const txGround = terrainSampler ? terrainSampler({ lat: sampleLat, lon: sampleLon }) : null;
  const terrainLoss =
    model === "ITM" && terrainSampler && txGround !== null
      ? estimateTerrainExcessLossDb({
          from: { lat: sampleLat, lon: sampleLon },
          to: rxSite.position,
          fromAntennaAbsM: txGround + txSystem.antennaHeightM,
          toAntennaAbsM: rxSite.groundElevationM + rxSite.antennaHeightM,
          frequencyMHz,
          terrainSampler,
          samples: terrainSamples,
        })
      : 0;

  const eirp = txSystem.txPowerDbm + txSystem.txGainDbi - txSystem.cableLossDb;
  return eirp + txSystem.rxGainDbi - (loss + terrainLoss);
};

const polarOffsets = (maxKm: number, rings: number, spokes: number): { dk: number; az: number }[] => {
  const out: { dk: number; az: number }[] = [];
  for (let r = 1; r <= rings; r += 1) {
    const dk = (maxKm * r) / rings;
    for (let s = 0; s < spokes; s += 1) {
      const az = (360 * s) / spokes;
      out.push({ dk, az });
    }
  }
  return out;
};

const move = (lat: number, lon: number, distanceKm: number, azimuthDeg: number): { lat: number; lon: number } => {
  const R = 6371;
  const brng = toRadians(azimuthDeg);
  const phi1 = toRadians(lat);
  const lambda1 = toRadians(lon);
  const delta = distanceKm / R;

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(brng),
  );

  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    );

  return { lat: (phi2 * 180) / Math.PI, lon: (lambda2 * 180) / Math.PI };
};

export const buildCoverage = (
  mode: CoverageMode,
  network: Network,
  sites: Site[],
  systems: RadioSystem[],
  model: PropagationModel,
  terrainSampler?: (coordinates: Coordinates) => number | null,
  options?: {
    sampleMultiplier?: number;
    terrainSamples?: number;
    onProgress?: (progress: number) => void;
  },
): CoverageSample[] => {
  if (!network.memberships.length || sites.length === 0) return [];
  const effectiveFrequencyMHz = network.frequencyOverrideMHz ?? network.frequencyMHz;
  const sampleMultiplier = Math.max(1, options?.sampleMultiplier ?? 1);
  const terrainSamples = Math.max(16, Math.round(options?.terrainSamples ?? 20));
  const onProgress = options?.onProgress;

  const center = midpoint(sites);
  const networkSites = network.memberships
    .map((m) => sites.find((s) => s.id === m.siteId))
    .filter((s): s is Site => Boolean(s));

  const samples: { lat: number; lon: number }[] = [];

  if (mode === "Polar") {
    const rings = Math.max(6, Math.round(10 * sampleMultiplier));
    const spokes = Math.max(18, Math.round(36 * sampleMultiplier));
    for (const p of polarOffsets(24, rings, spokes)) {
      samples.push(move(center.lat, center.lon, p.dk, p.az));
    }
  } else if (mode === "Route") {
    const from = networkSites[0] ?? sites[0];
    const to = networkSites[1] ?? sites[sites.length - 1] ?? from;
    const routePoints = Math.max(80, Math.round(120 * sampleMultiplier));
    for (let i = 0; i < routePoints; i += 1) {
      const t = routePoints <= 1 ? 0 : i / (routePoints - 1);
      samples.push({
        lat: interpolate(from.position.lat, to.position.lat, t),
        lon: interpolate(from.position.lon, to.position.lon, t),
      });
    }
  } else {
    const baseGridSize = mode === "Cartesian" ? 42 : 24;
    const targetSamples = Math.max(64, Math.round(baseGridSize * baseGridSize * sampleMultiplier * sampleMultiplier));
    const bounds = simulationAreaBoundsForSites(sites);
    if (!bounds) return [];

    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    const latSpanKm = Math.max(0.001, (bounds.maxLat - bounds.minLat) * 111.32);
    const lonScale = Math.max(0.1, Math.cos((centerLat * Math.PI) / 180));
    const lonSpanKm = Math.max(0.001, (bounds.maxLon - bounds.minLon) * 111.32 * lonScale);
    const aspect = latSpanKm / lonSpanKm;
    const cols = Math.max(6, Math.round(Math.sqrt(targetSamples / Math.max(0.2, Math.min(5, aspect)))));
    const rows = Math.max(6, Math.round(targetSamples / cols));

    for (let y = 0; y < rows; y += 1) {
      const ty = rows <= 1 ? 0 : y / (rows - 1);
      const lat = bounds.minLat + (bounds.maxLat - bounds.minLat) * ty;
      for (let x = 0; x < cols; x += 1) {
        const tx = cols <= 1 ? 0 : x / (cols - 1);
        const lon = bounds.minLon + (bounds.maxLon - bounds.minLon) * tx;
        samples.push({ lat, lon });
      }
    }
  }

  onProgress?.(0.1);
  const total = Math.max(1, samples.length);
  const notifyEvery = Math.max(1, Math.floor(total / 40));
  const results: CoverageSample[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const rxLevels = network.memberships
      .map((m) => {
        const site = sites.find((s) => s.id === m.siteId);
        const system = systems.find((sys) => sys.id === m.systemId);
        if (!site || !system) return null;
        return evalRx(
          sample.lat,
          sample.lon,
          site,
          system,
          effectiveFrequencyMHz,
          model,
          terrainSamples,
          terrainSampler,
        );
      })
      .filter((v): v is number => v !== null);

    const valueDbm = rxLevels.length
      ? mode === "BestSite"
        ? Math.min(...rxLevels)
        : rxLevels.reduce((sum, x) => sum + x, 0) / rxLevels.length
      : -140;

    results.push({ ...sample, valueDbm });
    if ((i + 1) % notifyEvery === 0 || i === samples.length - 1) {
      onProgress?.(0.1 + ((i + 1) / total) * 0.9);
    }
  }
  return results;
};
