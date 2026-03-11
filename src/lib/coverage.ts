import { haversineDistanceKm } from "./geo";
import { getPathLossByModel } from "./rfModels";
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
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const evalRx = (
  sampleLat: number,
  sampleLon: number,
  rxSite: Site,
  txSystem: RadioSystem,
  frequencyMHz: number,
  model: PropagationModel,
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
          samples: 20,
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

const computeAspectAwareGrid = (
  networkSites: Site[],
  fallbackCenter: { lat: number; lon: number },
  minSpanKm: number,
  marginKmPerSide: number,
  targetSamples: number,
): { centerLat: number; centerLon: number; latSpanKm: number; lonSpanKm: number; rows: number; cols: number } => {
  const sites = networkSites.length ? networkSites : [];
  if (!sites.length) {
    const side = Math.max(6, Math.round(Math.sqrt(targetSamples)));
    return {
      centerLat: fallbackCenter.lat,
      centerLon: fallbackCenter.lon,
      latSpanKm: minSpanKm,
      lonSpanKm: minSpanKm,
      rows: side,
      cols: side,
    };
  }

  const lats = sites.map((site) => site.position.lat);
  const lons = sites.map((site) => site.position.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;

  const latSpanKmRaw = Math.max(0, (maxLat - minLat) * 111.32);
  const lonScale = Math.max(0.1, Math.cos((centerLat * Math.PI) / 180));
  const lonSpanKmRaw = Math.max(0, (maxLon - minLon) * 111.32 * lonScale);

  const latSpanKm = Math.max(minSpanKm, latSpanKmRaw + marginKmPerSide * 2);
  const lonSpanKm = Math.max(minSpanKm, lonSpanKmRaw + marginKmPerSide * 2);

  const aspect = clamp(latSpanKm / Math.max(0.001, lonSpanKm), 0.2, 5);
  const cols = Math.max(6, Math.round(Math.sqrt(targetSamples / aspect)));
  const rows = Math.max(6, Math.round(targetSamples / cols));

  return { centerLat, centerLon, latSpanKm, lonSpanKm, rows, cols };
};

export const buildCoverage = (
  mode: CoverageMode,
  network: Network,
  sites: Site[],
  systems: RadioSystem[],
  model: PropagationModel,
  terrainSampler?: (coordinates: Coordinates) => number | null,
): CoverageSample[] => {
  if (!network.memberships.length || sites.length === 0) return [];
  const effectiveFrequencyMHz = network.frequencyOverrideMHz ?? network.frequencyMHz;

  const center = midpoint(sites);
  const networkSites = network.memberships
    .map((m) => sites.find((s) => s.id === m.siteId))
    .filter((s): s is Site => Boolean(s));

  const samples: { lat: number; lon: number }[] = [];

  if (mode === "Polar") {
    for (const p of polarOffsets(24, 10, 36)) {
      samples.push(move(center.lat, center.lon, p.dk, p.az));
    }
  } else if (mode === "Route") {
    const from = networkSites[0] ?? sites[0];
    const to = networkSites[1] ?? sites[sites.length - 1] ?? from;

    for (let i = 0; i < 120; i += 1) {
      const t = i / 119;
      samples.push({
        lat: interpolate(from.position.lat, to.position.lat, t),
        lon: interpolate(from.position.lon, to.position.lon, t),
      });
    }
  } else {
    const baseGridSize = mode === "Cartesian" ? 42 : 24;
    const minSpanKm = mode === "Cartesian" ? 24 : 18;
    const marginKmPerSide = mode === "Cartesian" ? 4 : 3;
    const targetSamples = baseGridSize * baseGridSize;
    // Extent should follow the actual scenario geometry (all sites), while signal values
    // are still computed from active network memberships below.
    const grid = computeAspectAwareGrid(sites, center, minSpanKm, marginKmPerSide, targetSamples);
    const halfLat = (grid.latSpanKm / 2) / 111.32;
    const halfLon = (grid.lonSpanKm / 2) / (111.32 * Math.max(0.1, Math.cos((grid.centerLat * Math.PI) / 180)));

    for (let y = 0; y < grid.rows; y += 1) {
      const ty = grid.rows <= 1 ? 0 : y / (grid.rows - 1);
      const lat = grid.centerLat - halfLat + ty * halfLat * 2;
      for (let x = 0; x < grid.cols; x += 1) {
        const tx = grid.cols <= 1 ? 0 : x / (grid.cols - 1);
        const lon = grid.centerLon - halfLon + tx * halfLon * 2;
        samples.push({ lat, lon });
      }
    }
  }

  return samples.map((sample) => {
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
          terrainSampler,
        );
      })
      .filter((v): v is number => v !== null);

    const valueDbm = rxLevels.length
      ? mode === "BestSite"
        ? Math.min(...rxLevels)
        : rxLevels.reduce((sum, x) => sum + x, 0) / rxLevels.length
      : -140;

    return { ...sample, valueDbm };
  });
};
