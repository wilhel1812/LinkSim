import { haversineDistanceKm, interpolateCoordinate } from "./geo";
import { fsplDb, getPathLossByModel } from "./rfModels";
import { estimateTerrainExcessLossDb } from "./terrainLoss";
import type {
  BestSiteCandidate,
  Coordinates,
  Link,
  LinkAnalysis,
  ProfilePoint,
  PropagationModel,
  Site,
} from "../types/radio";

const EARTH_RADIUS_M = 6_371_000;

type TerrainSampler = (coordinates: Coordinates) => number | null;

const firstFresnelRadiusM = (
  distanceKm: number,
  frequencyMHz: number,
  t: number,
): number => {
  const dTotalM = distanceKm * 1000;
  const d1 = dTotalM * t;
  const d2 = dTotalM - d1;
  const wavelengthM = 300 / frequencyMHz;
  return Math.sqrt((wavelengthM * d1 * d2) / dTotalM);
};

const earthBulgeM = (distanceKm: number, t: number): number => {
  const dTotalM = distanceKm * 1000;
  const x = dTotalM * t;
  return (x * (dTotalM - x)) / (2 * EARTH_RADIUS_M);
};

const buildTerrainPoint = (
  t: number,
  distanceKm: number,
  fromSite: Site,
  toSite: Site,
  link: Link,
  terrainSampler?: TerrainSampler,
): ProfilePoint => {
  const fromAntennaAbsM = fromSite.groundElevationM + fromSite.antennaHeightM;
  const toAntennaAbsM = toSite.groundElevationM + toSite.antennaHeightM;

  const distanceAtPointKm = distanceKm * t;
  const losM = fromAntennaAbsM + (toAntennaAbsM - fromAntennaAbsM) * t;
  const alongPath = interpolateCoordinate(fromSite.position, toSite.position, t);

  const terrainFromSampler = terrainSampler?.(alongPath) ?? null;

  const terrainBaseM =
    fromSite.groundElevationM + (toSite.groundElevationM - fromSite.groundElevationM) * t;

  const syntheticVariationM =
    Math.sin(t * Math.PI * 2) * 7 +
    Math.sin(t * Math.PI * 4.5) * 3 +
    Math.exp(-((t - 0.48) ** 2) / 0.02) * 18;

  const bulgeM = earthBulgeM(distanceKm, t);
  const terrainM = (terrainFromSampler ?? terrainBaseM + syntheticVariationM) + bulgeM;

  const fresnel = firstFresnelRadiusM(distanceKm, link.frequencyMHz, t);

  return {
    distanceKm: distanceAtPointKm,
    lat: alongPath.lat,
    lon: alongPath.lon,
    terrainM,
    losM,
    fresnelTopM: losM + fresnel,
    fresnelBottomM: losM - fresnel,
  };
};

export const buildProfile = (
  link: Link,
  fromSite: Site,
  toSite: Site,
  terrainSampler?: TerrainSampler,
  samples = 80,
): ProfilePoint[] => {
  const distanceKm = Math.max(0.001, haversineDistanceKm(fromSite.position, toSite.position));

  return Array.from({ length: samples }, (_, i) => {
    const t = i / (samples - 1);
    return buildTerrainPoint(t, distanceKm, fromSite, toSite, link, terrainSampler);
  });
};

export const analyzeLink = (
  link: Link,
  fromSite: Site,
  toSite: Site,
  model: PropagationModel,
  terrainSampler?: TerrainSampler,
  options?: { terrainSamples?: number },
): LinkAnalysis => {
  const distanceKm = Math.max(0.001, haversineDistanceKm(fromSite.position, toSite.position));
  const fromAntennaAbsM = fromSite.groundElevationM + fromSite.antennaHeightM;
  const toAntennaAbsM = toSite.groundElevationM + toSite.antennaHeightM;

  const basePathLossDb = getPathLossByModel(
    model,
    distanceKm,
    link.frequencyMHz,
    fromSite.antennaHeightM,
    toSite.antennaHeightM,
  );

  let terrainPenaltyDb = 0;
  if (model === "ITM" && terrainSampler) {
    terrainPenaltyDb = estimateTerrainExcessLossDb({
      from: fromSite.position,
      to: toSite.position,
      fromAntennaAbsM: fromAntennaAbsM,
      toAntennaAbsM: toAntennaAbsM,
      frequencyMHz: link.frequencyMHz,
      terrainSampler,
      samples: Math.max(24, Math.round(options?.terrainSamples ?? 32)),
    });
  }

  const pathLossDb = basePathLossDb + terrainPenaltyDb;
  const pureFsplDb = fsplDb(distanceKm, link.frequencyMHz);
  const eirpDbm = link.txPowerDbm + link.txGainDbi - link.cableLossDb;
  const rxLevelDbm = eirpDbm + link.rxGainDbi - pathLossDb;

  const midpointLineM = (fromAntennaAbsM + toAntennaAbsM) / 2;
  const midpointTerrainM = (fromSite.groundElevationM + toSite.groundElevationM) / 2;
  const midpointBulgeM = earthBulgeM(distanceKm, 0.5);
  const fresnelMidpointM = firstFresnelRadiusM(distanceKm, link.frequencyMHz, 0.5);

  const geometricClearanceM = midpointLineM - (midpointTerrainM + midpointBulgeM);
  const estimatedFresnelClearancePercent = Math.max(
    0,
    Math.min(100, (geometricClearanceM / fresnelMidpointM) * 100),
  );

  return {
    linkId: link.id,
    model,
    distanceKm,
    pathLossDb,
    fsplDb: pureFsplDb,
    eirpDbm,
    rxLevelDbm,
    midpointEarthBulgeM: midpointBulgeM,
    firstFresnelRadiusM: fresnelMidpointM,
    geometricClearanceM,
    estimatedFresnelClearancePercent,
  };
};

export const computeBestSiteGrid = (
  targetSites: Site[],
  frequencyMHz: number,
  txPowerDbm: number,
  txGainDbi: number,
  rxGainDbi: number,
  cableLossDb: number,
  center: Coordinates,
  spanKm: number,
  gridSize: number,
  model: PropagationModel,
): BestSiteCandidate[] => {
  const halfSpanDegLat = spanKm / 111.32;
  const halfSpanDegLon = spanKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));

  const candidates: BestSiteCandidate[] = [];

  for (let y = 0; y < gridSize; y += 1) {
    const ty = y / (gridSize - 1);
    const lat = center.lat - halfSpanDegLat + ty * halfSpanDegLat * 2;

    for (let x = 0; x < gridSize; x += 1) {
      const tx = x / (gridSize - 1);
      const lon = center.lon - halfSpanDegLon + tx * halfSpanDegLon * 2;

      const rxLevels = targetSites.map((site) => {
        const distanceKm = Math.max(
          0.001,
          haversineDistanceKm({ lat, lon }, { lat: site.position.lat, lon: site.position.lon }),
        );
        const pathLoss = getPathLossByModel(
          model,
          distanceKm,
          frequencyMHz,
          2,
          site.antennaHeightM,
        );
        const eirp = txPowerDbm + txGainDbi - cableLossDb;
        return eirp + rxGainDbi - pathLoss;
      });

      const worstRxDbm = Math.min(...rxLevels);
      const avgRxDbm = rxLevels.reduce((sum, value) => sum + value, 0) / rxLevels.length;

      candidates.push({ lat, lon, worstRxDbm, avgRxDbm });
    }
  }

  return candidates;
};
