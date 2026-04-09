import { haversineDistanceKm } from "./geo";
import { getPathLossDb } from "./rfModels";
import {
  atmosphericBendingNUnitsToKFactor,
  estimateTerrainExcessLossDb,
  isTerrainLineObstructed,
} from "./terrainLoss";
import type { Link, PropagationEnvironment, Site } from "../types/radio";

export type PassFailState = "pass_clear" | "pass_blocked" | "fail_clear" | "fail_blocked";

export const classifyPassFailState = (pass: boolean, losBlocked: boolean): PassFailState => {
  if (pass && !losBlocked) return "pass_clear";
  if (pass && losBlocked) return "pass_blocked";
  if (!pass && !losBlocked) return "fail_clear";
  return "fail_blocked";
};

export const passFailStateLabel = (state: PassFailState): string => {
  switch (state) {
    case "pass_clear":
      return "LOS clear + pass";
    case "pass_blocked":
      return "LOS blocked + pass";
    case "fail_clear":
      return "LOS clear + fail";
    case "fail_blocked":
      return "LOS blocked + fail";
  }
};

export const computeSourceCentricRxMetrics = (
  lat: number,
  lon: number,
  fromSite: Site,
  effectiveLink: Link,
  receiverAntennaHeightM: number,
  receiverRxGainDbi: number,
  terrainSampler: (lat: number, lon: number) => number | null,
  terrainSamples: number,
  environment?: PropagationEnvironment,
): { rxDbm: number; terrainPenaltyDb: number; terrainObstructed: boolean } => {
  const distanceKm = Math.max(0.001, haversineDistanceKm(fromSite.position, { lat, lon }));
  const kFactor = atmosphericBendingNUnitsToKFactor(environment?.atmosphericBendingNUnits ?? 301);
  const clutterHeightM = environment?.clutterHeightM ?? 0;
  const polarization = environment?.polarization ?? "Vertical";
  const baseLoss = getPathLossDb(
    distanceKm,
    effectiveLink.frequencyMHz,
    fromSite.antennaHeightM,
    receiverAntennaHeightM,
    environment,
  );

  let terrainPenaltyDb = 0;
  let terrainObstructed = false;
  const sampleTerrainAt = (sampleLat: number, sampleLon: number): number | null => terrainSampler(sampleLat, sampleLon);
  const rxGround = sampleTerrainAt(lat, lon);
  if (rxGround !== null) {
    terrainPenaltyDb = estimateTerrainExcessLossDb({
      from: fromSite.position,
      to: { lat, lon },
      fromAntennaAbsM: fromSite.groundElevationM + fromSite.antennaHeightM,
      toAntennaAbsM: rxGround + receiverAntennaHeightM,
      frequencyMHz: effectiveLink.frequencyMHz,
      terrainSampler: ({ lat: y, lon: x }) => sampleTerrainAt(y, x),
      terrainSamplerAt: sampleTerrainAt,
      samples: terrainSamples,
      kFactor,
      clutterHeightM,
      polarization,
    });
    terrainObstructed = isTerrainLineObstructed({
      from: fromSite.position,
      to: { lat, lon },
      fromAntennaAbsM: fromSite.groundElevationM + fromSite.antennaHeightM,
      toAntennaAbsM: rxGround + receiverAntennaHeightM,
      terrainSampler: ({ lat: y, lon: x }) => sampleTerrainAt(y, x),
      terrainSamplerAt: sampleTerrainAt,
      samples: Math.max(12, Math.round(terrainSamples * 0.66)),
      kFactor,
      clutterHeightM,
    });
  }

  const txPowerDbm = effectiveLink.txPowerDbm ?? fromSite.txPowerDbm;
  const txGainDbi = effectiveLink.txGainDbi ?? fromSite.txGainDbi;
  const cableLossDb = effectiveLink.cableLossDb ?? fromSite.cableLossDb;
  const rxGainDbi = effectiveLink.rxGainDbi ?? receiverRxGainDbi;
  const eirpDbm = txPowerDbm + txGainDbi - cableLossDb;
  return {
    rxDbm: eirpDbm + rxGainDbi - (baseLoss + terrainPenaltyDb),
    terrainPenaltyDb,
    terrainObstructed,
  };
};
