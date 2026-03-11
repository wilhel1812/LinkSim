import { describe, expect, it } from "vitest";
import { estimateTerrainExcessLossDb } from "./terrainLoss";

const flatSampler = () => 100;

const ridgeSampler = ({ lat }: { lat: number; lon: number }) => {
  const t = (lat - 59.9) / 0.1;
  const ridge = Math.exp(-((t - 0.5) ** 2) / 0.01) * 80;
  return 100 + ridge;
};

describe("estimateTerrainExcessLossDb", () => {
  it("returns near-zero excess loss on flat terrain", () => {
    const loss = estimateTerrainExcessLossDb({
      from: { lat: 59.9, lon: 10.7 },
      to: { lat: 60.0, lon: 10.7 },
      fromAntennaAbsM: 120,
      toAntennaAbsM: 120,
      frequencyMHz: 869.618,
      terrainSampler: flatSampler,
      samples: 24,
    });

    expect(loss).toBeLessThan(1);
  });

  it("returns higher loss for obstructed ridge terrain", () => {
    const loss = estimateTerrainExcessLossDb({
      from: { lat: 59.9, lon: 10.7 },
      to: { lat: 60.0, lon: 10.7 },
      fromAntennaAbsM: 102,
      toAntennaAbsM: 102,
      frequencyMHz: 869.618,
      terrainSampler: ridgeSampler,
      samples: 24,
    });

    expect(loss).toBeGreaterThan(5);
  });
});
