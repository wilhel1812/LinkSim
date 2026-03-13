import { haversineDistanceKm } from "./geo";
import { getPathLossByModel } from "./rfModels";
import { estimateTerrainExcessLossDb, isTerrainLineObstructed } from "./terrainLoss";
import type { Link, PropagationModel, Site } from "../types/radio";

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
  propagationModel: PropagationModel,
  terrainSampler: (lat: number, lon: number) => number | null,
  terrainSamples: number,
): { rxDbm: number; terrainPenaltyDb: number; terrainObstructed: boolean } => {
  const distanceKm = Math.max(0.001, haversineDistanceKm(fromSite.position, { lat, lon }));
  const baseLoss = getPathLossByModel(
    propagationModel,
    distanceKm,
    effectiveLink.frequencyMHz,
    fromSite.antennaHeightM,
    receiverAntennaHeightM,
  );

  let terrainPenaltyDb = 0;
  let terrainObstructed = false;
  if (propagationModel === "ITM") {
    const rxGround = terrainSampler(lat, lon);
    if (rxGround !== null) {
      terrainPenaltyDb = estimateTerrainExcessLossDb({
        from: fromSite.position,
        to: { lat, lon },
        fromAntennaAbsM: fromSite.groundElevationM + fromSite.antennaHeightM,
        toAntennaAbsM: rxGround + receiverAntennaHeightM,
        frequencyMHz: effectiveLink.frequencyMHz,
        terrainSampler: ({ lat: y, lon: x }) => terrainSampler(y, x),
        samples: terrainSamples,
      });
      terrainObstructed = isTerrainLineObstructed({
        from: fromSite.position,
        to: { lat, lon },
        fromAntennaAbsM: fromSite.groundElevationM + fromSite.antennaHeightM,
        toAntennaAbsM: rxGround + receiverAntennaHeightM,
        terrainSampler: ({ lat: y, lon: x }) => terrainSampler(y, x),
        samples: Math.max(12, Math.round(terrainSamples * 0.66)),
      });
    }
  }

  const eirpDbm = effectiveLink.txPowerDbm + effectiveLink.txGainDbi - effectiveLink.cableLossDb;
  return {
    rxDbm: eirpDbm + effectiveLink.rxGainDbi - (baseLoss + terrainPenaltyDb),
    terrainPenaltyDb,
    terrainObstructed,
  };
};
