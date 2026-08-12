import { describe, expect, it } from "vitest";
import {
  buildAdaptiveCoverageOverlayPixelsAsync,
  buildCoverageOverlayPixelsAsync,
  buildMeshExtensionOverlayPixelsAsync,
  computeCoverageRxTargetScale,
  deriveMeshExtensionCandidateProfile,
  meshExtensionAlphaForDbm,
  meshExtensionColorForArea,
  resolveMeshExtensionCandidateGridSize,
  resolveMeshExtensionCoverageGridSize,
  strongestBidirectionalPeerDbm,
  normalizeCoverageDbmForRxTarget,
  buildRelayCandidateOverlayPixelsAsync,
  buildSourcePassFailOverlayPixelsAsync,
  buildTerrainShadeOverlayPixelsAsync,
  latitudeForRasterRow,
  OverlayTaskCancelledError,
  type CoverageSampleLite,
  type TerrainBounds,
} from "./overlayRaster";
import { computeCoverageGridDimensions } from "./coverage";
import type { Link, PropagationEnvironment, Site } from "../types/radio";

const bounds: TerrainBounds = {
  minLat: 59.8,
  maxLat: 60.0,
  minLon: 10.6,
  maxLon: 10.8,
};

const samples: CoverageSampleLite[] = [
  { lat: 59.8, lon: 10.6, valueDbm: -112 },
  { lat: 59.8, lon: 10.8, valueDbm: -92 },
  { lat: 60.0, lon: 10.6, valueDbm: -99 },
  { lat: 60.0, lon: 10.8, valueDbm: -72 },
];

const fromSite: Site = {
  id: "a",
  name: "A",
  position: { lat: 59.9, lon: 10.65 },
  groundElevationM: 120,
  antennaHeightM: 15,
  txPowerDbm: 20,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
};

const toSite: Site = {
  id: "b",
  name: "B",
  position: { lat: 59.93, lon: 10.74 },
  groundElevationM: 140,
  antennaHeightM: 12,
  txPowerDbm: 20,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
};

const link: Link = {
  id: "link-1",
  fromSiteId: fromSite.id,
  toSiteId: toSite.id,
  frequencyMHz: 868,
};

const environment: PropagationEnvironment = {
  radioClimate: "Continental Temperate",
  polarization: "Vertical",
  clutterHeightM: 10,
  groundDielectric: 15,
  groundConductivity: 0.005,
  atmosphericBendingNUnits: 301,
};

const terrainSampler = () => 135;

describe("overlayRaster async builders", () => {
  it("changes visible Pass/Fail pixels for directional orientation and pattern edits", async () => {
    const dimensions = { width: 41, height: 41 };
    const render = (site: Site) => buildSourcePassFailOverlayPixelsAsync(
      bounds,
      site,
      link,
      toSite.antennaHeightM,
      toSite.rxGainDbi,
      environment,
      -118,
      0,
      terrainSampler,
      dimensions,
      24,
      undefined,
      undefined,
      { adaptive: false },
    );
    const omni = await render(fromSite);
    const north = await render({
      ...fromSite,
      antennaMode: "directional",
      antennaAzimuthDeg: 0,
      antennaTiltDeg: 0,
      antennaHorizontalBeamwidthDeg: 60,
      antennaVerticalBeamwidthDeg: 30,
      antennaMaxAttenuationDb: 25,
    });
    const south = await render({
      ...fromSite,
      antennaMode: "directional",
      antennaAzimuthDeg: 180,
      antennaTiltDeg: 0,
      antennaHorizontalBeamwidthDeg: 30,
      antennaVerticalBeamwidthDeg: 30,
      antennaMaxAttenuationDb: 25,
    });

    expect(omni).not.toBeNull();
    expect(north).not.toBeNull();
    expect(south).not.toBeNull();
    expect(Array.from(north!.pixels)).not.toEqual(Array.from(omni!.pixels));
    expect(Array.from(south!.pixels)).not.toEqual(Array.from(north!.pixels));
  });

  it("applies the selected destination receive pattern to Pass/Fail pixels", async () => {
    const dimensions = { width: 41, height: 41 };
    const render = (receiverSite: Site) => buildSourcePassFailOverlayPixelsAsync(
      bounds,
      fromSite,
      link,
      receiverSite.antennaHeightM,
      receiverSite.rxGainDbi,
      environment,
      -118,
      0,
      terrainSampler,
      dimensions,
      24,
      undefined,
      undefined,
      { adaptive: false },
      receiverSite,
    );
    const toward = await render({
      ...toSite,
      antennaMode: "directional",
      antennaAzimuthDeg: 236,
      antennaTiltDeg: 0,
      antennaHorizontalBeamwidthDeg: 30,
      antennaVerticalBeamwidthDeg: 30,
      antennaMaxAttenuationDb: 25,
    });
    const away = await render({
      ...toSite,
      antennaMode: "directional",
      antennaAzimuthDeg: 56,
      antennaTiltDeg: 0,
      antennaHorizontalBeamwidthDeg: 30,
      antennaVerticalBeamwidthDeg: 30,
      antennaMaxAttenuationDb: 25,
    });

    expect(toward).not.toBeNull();
    expect(away).not.toBeNull();
    expect(Array.from(away!.pixels)).not.toEqual(Array.from(toward!.pixels));
  });

  it("applies the destination receive pattern on the second Relay leg", async () => {
    const dimensions = { width: 25, height: 25 };
    const render = (destination: Site) => buildRelayCandidateOverlayPixelsAsync(
      bounds,
      fromSite,
      destination,
      link,
      environment,
      0,
      terrainSampler,
      dimensions,
      24,
      undefined,
      undefined,
      { adaptive: false },
    );
    const north = await render({
      ...toSite,
      antennaMode: "directional",
      antennaAzimuthDeg: 0,
      antennaTiltDeg: 0,
      antennaHorizontalBeamwidthDeg: 25,
      antennaVerticalBeamwidthDeg: 30,
      antennaMaxAttenuationDb: 40,
    });
    const south = await render({
      ...toSite,
      antennaMode: "directional",
      antennaAzimuthDeg: 180,
      antennaTiltDeg: 0,
      antennaHorizontalBeamwidthDeg: 25,
      antennaVerticalBeamwidthDeg: 30,
      antennaMaxAttenuationDb: 40,
    });

    expect(north).not.toBeNull();
    expect(south).not.toBeNull();
    expect(Array.from(north!.signalValuesDbm!)).not.toEqual(Array.from(south!.signalValuesDbm!));
  });

  it("builds Heatmap on the Pass/Fail logical grid with bounded adaptive error", async () => {
    const dimensions = { width: 312, height: 312 };
    let exactEvaluations = 0;
    let adaptiveEvaluations = 0;
    const evaluateSignal = (lat: number, lon: number) => {
      const latOffset = (lat - 59.9) / 0.1;
      const lonOffset = (lon - 10.7) / 0.1;
      const ridgeOffset = latOffset - lonOffset * 0.4 - 0.42;
      const strongestDbm = -116 + lonOffset * 16 + Math.exp(-(ridgeOffset ** 2) / 0.006) * 11;
      return strongestDbm;
    };
    const exact = await buildAdaptiveCoverageOverlayPixelsAsync({
      bounds,
      dimensions,
      initialGridSize: 24,
      mode: "heatmap",
      rxTargetDbm: -118,
      contributors: [{ id: "site-a", evaluatePoint: (lat, lon) => {
          exactEvaluations += 1;
          return evaluateSignal(lat, lon);
        } }],
      adaptive: false,
    });
    const adaptive = await buildAdaptiveCoverageOverlayPixelsAsync({
      bounds,
      dimensions,
      initialGridSize: 24,
      mode: "heatmap",
      rxTargetDbm: -118,
      contributors: [{ id: "site-a", evaluatePoint: (lat, lon) => {
          adaptiveEvaluations += 1;
          return evaluateSignal(lat, lon);
        } }],
      adaptive: true,
    });

    expect(exact?.signalValuesDbm).toHaveLength(dimensions.width * dimensions.height);
    expect(adaptive?.signalValuesDbm).toHaveLength(dimensions.width * dimensions.height);
    const errors = Array.from(exact!.signalValuesDbm!, (value, index) =>
      Math.abs(value - adaptive!.signalValuesDbm![index]));
    errors.sort((left, right) => left - right);
    expect(errors[Math.floor(errors.length * 0.5)]).toBeLessThanOrEqual(0.25);
    expect(errors[Math.floor(errors.length * 0.99)]).toBeLessThanOrEqual(1);
    expect(adaptiveEvaluations).toBeLessThan(exactEvaluations * 0.45);
    expect(adaptive?.analysisStats?.totalPixels).toBe(dimensions.width * dimensions.height);
  });

  it("reuses the same canonical signal samples when switching between strongest-signal overlays", async () => {
    const dimensions = { width: 96, height: 96 };
    let evaluations = 0;
    const common = {
      bounds,
      dimensions,
      initialGridSize: 24,
      rxTargetDbm: -118,
      contributors: [{ id: "site-a", evaluatePoint: (lat: number, lon: number) => {
        evaluations += 1;
        return -104 + (lat - bounds.minLat) * 20 + (lon - bounds.minLon) * 10;
      } }],
      adaptive: true,
      analysisCacheKey: "coverage-mode-switch-cache",
    } as const;
    const heatmap = await buildAdaptiveCoverageOverlayPixelsAsync({ ...common, mode: "heatmap" });
    const firstEvaluations = evaluations;
    const contours = await buildAdaptiveCoverageOverlayPixelsAsync({ ...common, mode: "contours" });

    expect(heatmap?.signalValuesDbm).toHaveLength(dimensions.width * dimensions.height);
    expect(contours?.signalValuesDbm).toHaveLength(dimensions.width * dimensions.height);
    expect(evaluations).toBe(firstEvaluations);
    expect(contours?.analysisStats?.evaluatedPaths).toBe(0);
  });

  it("keeps multi-contributor strongest and weakest surfaces within the accuracy gate", async () => {
    const dimensions = { width: 96, height: 96 };
    const contributors = [
      { id: "a", evaluatePoint: (lat: number, lon: number) => -86 - (lat - 59.84) ** 2 * 900 - (lon - 10.64) ** 2 * 700 },
      { id: "b", evaluatePoint: (lat: number, lon: number) => -90 - (lat - 59.96) ** 2 * 650 - (lon - 10.76) ** 2 * 850 },
      { id: "c", evaluatePoint: (lat: number, lon: number) => -94 + (lat - bounds.minLat) * 22 - (lon - bounds.minLon) * 15 },
      { id: "d", evaluatePoint: (lat: number, lon: number) => -82 - (lat - bounds.minLat) * 28 + (lon - bounds.minLon) * 10 },
    ];
    const build = (mode: "heatmap" | "weakest", adaptive: boolean) =>
      buildAdaptiveCoverageOverlayPixelsAsync({
        bounds,
        dimensions,
        initialGridSize: 24,
        mode,
        rxTargetDbm: -118,
        contributors,
        adaptive,
      });
    const [exactStrongest, adaptiveStrongest, exactWeakest, adaptiveWeakest] = await Promise.all([
      build("heatmap", false),
      build("heatmap", true),
      build("weakest", false),
      build("weakest", true),
    ]);
    const assertAccuracy = (exact: Float32Array, adaptive: Float32Array) => {
      const errors = Array.from(exact, (value, index) => Math.abs(value - adaptive[index]))
        .sort((left, right) => left - right);
      expect(errors[Math.floor(errors.length * 0.5)]).toBeLessThanOrEqual(0.25);
      expect(errors[Math.floor(errors.length * 0.99)]).toBeLessThanOrEqual(1);
    };

    assertAccuracy(exactStrongest!.signalValuesDbm!, adaptiveStrongest!.signalValuesDbm!);
    assertAccuracy(exactWeakest!.signalValuesDbm!, adaptiveWeakest!.signalValuesDbm!);
  });

  it("keeps strongest and weakest coverage work roughly linear from one through eight contributors", async () => {
    const dimensions = { width: 160, height: 160 };
    for (const mode of ["heatmap", "weakest"] as const) {
      const evaluationsByCount: number[] = [];

      for (let contributorCount = 1; contributorCount <= 8; contributorCount += 1) {
        let evaluations = 0;
        const contributors = Array.from({ length: contributorCount }, (_, contributorIndex) => ({
          id: `site-${contributorIndex}`,
          evaluatePoint: (lat: number, lon: number) => {
            evaluations += 1;
            if (contributorIndex === 0) {
              const baseDbm = mode === "heatmap" ? -89 : -109;
              return baseDbm + (lat - bounds.minLat) * 2 + (lon - bounds.minLon);
            }
            const frequency = 35 + contributorIndex * 3;
            const dominatedDbm = mode === "heatmap" ? -108 : -80;
            return dominatedDbm
              + Math.sin((lat - bounds.minLat) * frequency * Math.PI) * 6
              + Math.cos((lon - bounds.minLon) * frequency * Math.PI) * 6;
          },
        }));

        const raster = await buildAdaptiveCoverageOverlayPixelsAsync({
          bounds,
          dimensions,
          initialGridSize: 24,
          mode,
          rxTargetDbm: -118,
          contributors,
          adaptive: true,
        });

        expect(raster?.signalValuesDbm).toHaveLength(dimensions.width * dimensions.height);
        evaluationsByCount.push(evaluations);
      }

      const singleContributorWork = evaluationsByCount[0];
      evaluationsByCount.forEach((evaluations, index) => {
        const contributorCount = index + 1;
        expect(evaluations).toBeLessThanOrEqual(singleContributorWork * contributorCount * 1.35);
      });
    }
  });

  it("keeps Heatmap scaling bounded when each added contributor wins a local area", async () => {
    const dimensions = { width: 160, height: 160 };
    const centers = [
      [59.84, 10.64], [59.96, 10.76], [59.96, 10.64], [59.84, 10.76],
      [59.90, 10.70], [59.90, 10.64], [59.90, 10.76], [59.84, 10.70],
    ] as const;
    const uniqueSamplesByCount: number[] = [];

    for (let contributorCount = 1; contributorCount <= centers.length; contributorCount += 1) {
      let evaluations = 0;
      const contributors = centers.slice(0, contributorCount).map(([centerLat, centerLon], contributorIndex) => ({
        id: `local-winner-${contributorIndex}`,
        evaluatePoint: (lat: number, lon: number) => {
          evaluations += 1;
          return -82 - (lat - centerLat) ** 2 * 1_100 - (lon - centerLon) ** 2 * 850;
        },
      }));
      await buildAdaptiveCoverageOverlayPixelsAsync({
        bounds,
        dimensions,
        initialGridSize: 24,
        mode: "heatmap",
        rxTargetDbm: -118,
        contributors,
        adaptive: true,
      });
      uniqueSamplesByCount.push(evaluations / contributorCount);
    }

    const singleContributorSamples = uniqueSamplesByCount[0];
    expect(Math.max(...uniqueSamplesByCount)).toBeLessThanOrEqual(singleContributorSamples * 2.5);
  });

  it("does not introduce a three-or-four Site cliff when the buffered selection hull expands", async () => {
    const dimensions = { width: 160, height: 160 };
    const positions = [
      [0.25, 0.30], [0.75, 0.30], [0.50, 0.72], [0.50, 0.12],
      [0.18, 0.55], [0.82, 0.55], [0.35, 0.82], [0.65, 0.82],
    ] as const;
    const distanceToSegment = (x: number, y: number, a: readonly [number, number], b: readonly [number, number]) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared));
      return Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
    };
    const convexHull = (points: ReadonlyArray<readonly [number, number]>): Array<readonly [number, number]> => {
      if (points.length <= 2) return [...points];
      const sorted = [...points].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
      const cross = (origin: readonly [number, number], a: readonly [number, number], b: readonly [number, number]) =>
        (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
      const half = (input: Array<readonly [number, number]>) => {
        const output: Array<readonly [number, number]> = [];
        for (const point of input) {
          while (output.length >= 2 && cross(output[output.length - 2], output[output.length - 1], point) <= 0) output.pop();
          output.push(point);
        }
        output.pop();
        return output;
      };
      return [...half(sorted), ...half(sorted.reverse())];
    };
    const bufferedHullMask = (selected: ReadonlyArray<readonly [number, number]>) => {
      const hull = convexHull(selected);
      return (lat: number, lon: number) => {
        const x = lon;
        const y = lat;
        if (hull.length === 1) return Math.hypot(x - hull[0][0], y - hull[0][1]) <= 0.24;
        let inside = false;
        if (hull.length >= 3) {
          for (let index = 0, previous = hull.length - 1; index < hull.length; previous = index, index += 1) {
            const currentPoint = hull[index];
            const previousPoint = hull[previous];
            if (
              currentPoint[1] > y !== previousPoint[1] > y &&
              x < ((previousPoint[0] - currentPoint[0]) * (y - currentPoint[1])) /
                ((previousPoint[1] - currentPoint[1]) || 1e-9) + currentPoint[0]
            ) inside = !inside;
          }
        }
        if (inside) return true;
        return hull.some((point, index) => distanceToSegment(x, y, point, hull[(index + 1) % hull.length]) <= 0.24);
      };
    };
    const workByCount: number[] = [];

    for (let contributorCount = 1; contributorCount <= positions.length; contributorCount += 1) {
      let evaluations = 0;
      const selected = positions.slice(0, contributorCount);
      const selectionBounds = {
        minLat: Math.min(...selected.map((position) => position[1])) - 0.24,
        maxLat: Math.max(...selected.map((position) => position[1])) + 0.24,
        minLon: Math.min(...selected.map((position) => position[0])) - 0.24,
        maxLon: Math.max(...selected.map((position) => position[0])) + 0.24,
      };
      const contributors = selected.map(([x, y], contributorIndex) => ({
        id: `hull-site-${contributorIndex}`,
        evaluatePoint: (lat: number, lon: number) => {
          evaluations += 1;
          return -82 - Math.hypot(lon - x, lat - y) * 24;
        },
      }));
      await buildAdaptiveCoverageOverlayPixelsAsync({
        bounds: selectionBounds,
        dimensions,
        initialGridSize: 24,
        mode: "heatmap",
        rxTargetDbm: -118,
        contributors,
        pointMask: bufferedHullMask(selected),
        adaptive: true,
      });
      workByCount.push(evaluations);
    }

    const singleSiteWork = workByCount[0];
    workByCount.forEach((work, index) => {
      expect(work).toBeLessThanOrEqual(singleSiteWork * (index + 1) * 1.4);
    });
  });

  it("combines contributors before adapting the requested coverage surface", async () => {
    const dimensions = { width: 192, height: 192 };
    let evaluations = 0;
    const contributors = [
      {
        id: "west",
        evaluatePoint: (_lat: number, lon: number) => {
          evaluations += 1;
          return -80 - (lon - bounds.minLon) * 120;
        },
      },
      {
        id: "east",
        evaluatePoint: (_lat: number, lon: number) => {
          evaluations += 1;
          return -104 + (lon - bounds.minLon) * 120;
        },
      },
      {
        id: "north",
        evaluatePoint: (lat: number) => {
          evaluations += 1;
          return -92 + (lat - bounds.minLat) * 50;
        },
      },
      {
        id: "south",
        evaluatePoint: (lat: number) => {
          evaluations += 1;
          return -82 - (lat - bounds.minLat) * 50;
        },
      },
    ];

    const raster = await buildAdaptiveCoverageOverlayPixelsAsync({
      bounds,
      dimensions,
      initialGridSize: 24,
      mode: "heatmap",
      rxTargetDbm: -118,
      contributors,
      adaptive: true,
    });

    expect(raster?.signalValuesDbm).toHaveLength(dimensions.width * dimensions.height);
    const productionPathBudget = computeCoverageGridDimensions(24, bounds).totalSamples * contributors.length;
    expect(evaluations).toBeLessThanOrEqual(productionPathBudget * 1.1);
    const center = Math.floor(dimensions.height / 2) * dimensions.width + Math.floor(dimensions.width / 2);
    expect(raster!.signalValuesDbm![center]).toBeGreaterThan(-93);
  });

  it("keeps adaptive Pass/Fail within the accuracy gate while reducing terrain work", async () => {
    const dimensions = { width: 120, height: 120 };
    let exactTerrainReads = 0;
    let adaptiveTerrainReads = 0;
    const exact = await buildSourcePassFailOverlayPixelsAsync(
      bounds,
      fromSite,
      link,
      toSite.antennaHeightM,
      toSite.rxGainDbi,
      environment,
      -118,
      0,
      () => {
        exactTerrainReads += 1;
        return 135;
      },
      dimensions,
      24,
      undefined,
      { phase: "passfail", signature: "passfail-reference" },
      { adaptive: false },
    );
    const adaptive = await buildSourcePassFailOverlayPixelsAsync(
      bounds,
      fromSite,
      link,
      toSite.antennaHeightM,
      toSite.rxGainDbi,
      environment,
      -118,
      0,
      () => {
        adaptiveTerrainReads += 1;
        return 135;
      },
      dimensions,
      24,
      undefined,
      { phase: "passfail", signature: "passfail-adaptive" },
      { adaptive: true },
    );

    expect(exact).not.toBeNull();
    expect(adaptive).not.toBeNull();
    let matchingPixels = 0;
    for (let index = 0; index < dimensions.width * dimensions.height; index += 1) {
      const offset = index * 4;
      const exactState = Array.from(exact!.pixels.slice(offset, offset + 4)).join(",");
      const adaptiveState = Array.from(adaptive!.pixels.slice(offset, offset + 4)).join(",");
      if (exactState === adaptiveState) matchingPixels += 1;
    }
    expect(matchingPixels / (dimensions.width * dimensions.height)).toBeGreaterThanOrEqual(0.99);
    expect(adaptiveTerrainReads).toBeLessThan(exactTerrainReads * 0.3);
    expect(adaptive?.analysisStats?.evaluatedPaths).toBeLessThan(dimensions.width * dimensions.height * 0.3);
  });

  it("keeps adaptive Relay signal within the error gate while reducing terrain work", async () => {
    const dimensions = { width: 120, height: 120 };
    let exactTerrainReads = 0;
    let adaptiveTerrainReads = 0;
    const exact = await buildRelayCandidateOverlayPixelsAsync(
      bounds,
      fromSite,
      toSite,
      link,
      environment,
      0,
      () => {
        exactTerrainReads += 1;
        return 135;
      },
      dimensions,
      24,
      undefined,
      { phase: "relay", signature: "relay-reference" },
      { adaptive: false },
    );
    const adaptive = await buildRelayCandidateOverlayPixelsAsync(
      bounds,
      fromSite,
      toSite,
      link,
      environment,
      0,
      () => {
        adaptiveTerrainReads += 1;
        return 135;
      },
      dimensions,
      24,
      undefined,
      { phase: "relay", signature: "relay-adaptive" },
      { adaptive: true },
    );

    expect(exact).not.toBeNull();
    expect(adaptive).not.toBeNull();
    const signalErrors: number[] = [];
    for (let index = 0; index < dimensions.width * dimensions.height; index += 1) {
      signalErrors.push(Math.abs(exact!.signalValuesDbm![index] - adaptive!.signalValuesDbm![index]));
    }
    signalErrors.sort((left, right) => left - right);
    const medianError = signalErrors[Math.floor(signalErrors.length * 0.5)];
    expect(medianError).toBeLessThanOrEqual(0.5);
    expect(signalErrors[Math.floor(signalErrors.length * 0.99)]).toBeLessThanOrEqual(2);
    expect(adaptiveTerrainReads).toBeLessThan(exactTerrainReads * 0.3);
    expect(adaptive?.analysisStats?.evaluatedPaths).toBeLessThan(dimensions.width * dimensions.height * 0.3);
  });

  it("keeps adaptive Pass/Fail accurate across a narrow terrain ridge", async () => {
    const dimensions = { width: 96, height: 96 };
    const ridgeTerrain = (lat: number, lon: number) => {
      const latOffset = (lat - 59.9) / 0.1;
      const lonOffset = (lon - 10.7) / 0.1;
      return 105 + Math.exp(-((latOffset - lonOffset * 0.35 - 0.45) ** 2) / 0.0025) * 140;
    };
    const exact = await buildSourcePassFailOverlayPixelsAsync(
      bounds, fromSite, link, toSite.antennaHeightM, toSite.rxGainDbi, environment,
      -118, 0, ridgeTerrain, dimensions, 24, undefined,
      { phase: "passfail", signature: "ridge-reference" }, { adaptive: false },
    );
    const adaptive = await buildSourcePassFailOverlayPixelsAsync(
      bounds, fromSite, link, toSite.antennaHeightM, toSite.rxGainDbi, environment,
      -118, 0, ridgeTerrain, dimensions, 24, undefined,
      { phase: "passfail", signature: "ridge-adaptive" }, { adaptive: true },
    );

    let matchingPixels = 0;
    for (let index = 0; index < dimensions.width * dimensions.height; index += 1) {
      const offset = index * 4;
      if (
        exact!.pixels[offset] === adaptive!.pixels[offset] &&
        exact!.pixels[offset + 1] === adaptive!.pixels[offset + 1] &&
        exact!.pixels[offset + 2] === adaptive!.pixels[offset + 2]
      ) matchingPixels += 1;
    }
    expect(matchingPixels / (dimensions.width * dimensions.height)).toBeGreaterThanOrEqual(0.99);
  });

  it("keeps supersampled Pass/Fail boundaries close to the exact display-pixel result", async () => {
    const dimensions = { width: 312, height: 312 };
    const ridgeTerrain = (lat: number, lon: number) => {
      const latOffset = (lat - 59.9) / 0.1;
      const lonOffset = (lon - 10.7) / 0.1;
      const ridgeOffset = latOffset - lonOffset * 0.42 - 0.413;
      return 105 + Math.exp(-(ridgeOffset ** 2) / 0.0014) * 155;
    };
    const exact = await buildSourcePassFailOverlayPixelsAsync(
      bounds, fromSite, link, toSite.antennaHeightM, toSite.rxGainDbi, environment,
      -118, 0, ridgeTerrain, dimensions, 24, undefined,
      { phase: "passfail", signature: "supersampled-ridge-reference" }, { adaptive: false },
    );
    const adaptive = await buildSourcePassFailOverlayPixelsAsync(
      bounds, fromSite, link, toSite.antennaHeightM, toSite.rxGainDbi, environment,
      -118, 0, ridgeTerrain, dimensions, 24, undefined,
      { phase: "passfail", signature: "supersampled-ridge-adaptive" }, { adaptive: true },
    );

    let matchingPixels = 0;
    for (let index = 0; index < dimensions.width * dimensions.height; index += 1) {
      const offset = index * 4;
      if (
        exact!.pixels[offset] === adaptive!.pixels[offset] &&
        exact!.pixels[offset + 1] === adaptive!.pixels[offset + 1] &&
        exact!.pixels[offset + 2] === adaptive!.pixels[offset + 2]
      ) matchingPixels += 1;
    }
    const agreement = matchingPixels / (dimensions.width * dimensions.height);
    expect(agreement).toBeGreaterThanOrEqual(0.9999);
    expect(adaptive?.analysisStats?.evaluatedPaths).toBeLessThan(dimensions.width * dimensions.height * 0.45);
  });

  it("reuses cached Pass/Fail RF metrics when only the target changes", async () => {
    const dimensions = { width: 96, height: 96 };
    let firstReads = 0;
    let secondReads = 0;
    const common = [
      bounds, fromSite, link, toSite.antennaHeightM, toSite.rxGainDbi, environment,
    ] as const;
    await buildSourcePassFailOverlayPixelsAsync(
      ...common, -118, 0, () => { firstReads += 1; return 135; }, dimensions, 24, undefined,
      { phase: "passfail", signature: "cache-first" },
      { adaptive: true, analysisCacheKey: "passfail-target-cache" },
    );
    await buildSourcePassFailOverlayPixelsAsync(
      ...common, -112, 0, () => { secondReads += 1; return 135; }, dimensions, 24, undefined,
      { phase: "passfail", signature: "cache-second" },
      { adaptive: true, analysisCacheKey: "passfail-target-cache" },
    );

    expect(firstReads).toBeGreaterThan(0);
    expect(secondReads).toBeLessThan(firstReads * 0.2);
  });

  it("derives a representative mesh-extension profile from selected-site medians", () => {
    const profile = deriveMeshExtensionCandidateProfile([
      { ...fromSite, antennaHeightM: 4, txPowerDbm: 18, txGainDbi: 1, rxGainDbi: 2, cableLossDb: 0.5 },
      { ...toSite, antennaHeightM: 12, txPowerDbm: 24, txGainDbi: 5, rxGainDbi: 6, cableLossDb: 1.5 },
      { ...toSite, id: "c", antennaHeightM: 8, txPowerDbm: 22, txGainDbi: 3, rxGainDbi: 4, cableLossDb: 1 },
    ]);

    expect(profile).toEqual({
      antennaHeightM: 8,
      txPowerDbm: 22,
      txGainDbi: 3,
      rxGainDbi: 4,
      cableLossDb: 1,
    });
  });

  it("uses the strongest peer after taking each bidirectional bottleneck", () => {
    expect(
      strongestBidirectionalPeerDbm([
        { selectedToCandidateDbm: -95, candidateToSelectedDbm: -130 },
        { selectedToCandidateDbm: -108, candidateToSelectedDbm: -104 },
      ]),
    ).toBe(-108);
  });

  it("anchors mesh-extension opacity to established pass/fail and heatmap alpha levels", () => {
    expect(meshExtensionAlphaForDbm(-121, -120, { min: -150, max: -90 })).toBe(0);
    expect(meshExtensionAlphaForDbm(-120, -120, { min: -150, max: -90 })).toBe(162);
    expect(meshExtensionAlphaForDbm(-90, -120, { min: -150, max: -90 })).toBe(180);
  });

  it("uses the selected resolution for both candidate and coverage scoring", () => {
    expect(resolveMeshExtensionCandidateGridSize(24)).toBe(24);
    expect(resolveMeshExtensionCandidateGridSize(42)).toBe(42);
    expect(resolveMeshExtensionCandidateGridSize(168)).toBe(168);
    expect(resolveMeshExtensionCoverageGridSize(24)).toBe(24);
    expect(resolveMeshExtensionCoverageGridSize(84)).toBe(84);
    expect(resolveMeshExtensionCoverageGridSize(168)).toBe(168);
  });

  it("changes extension hue with new area independently of signal alpha", () => {
    expect(meshExtensionColorForArea(0, 20)).not.toEqual(meshExtensionColorForArea(20, 20));
    expect(meshExtensionAlphaForDbm(-140, -120, { min: -150, max: -90 })).not.toBe(
      meshExtensionAlphaForDbm(-100, -120, { min: -150, max: -90 }),
    );
  });

  it("samples raster rows in Web Mercator space so image overlays align with GeoJSON", () => {
    const minLat = 62.97069520171348;
    const maxLat = 63.869006376704505;

    expect(latitudeForRasterRow(0, 3, minLat, maxLat)).toBeCloseTo(maxLat, 12);
    expect(latitudeForRasterRow(2, 3, minLat, maxLat)).toBeCloseTo(minLat, 12);
    expect(latitudeForRasterRow(1, 3, minLat, maxLat)).toBeCloseTo(63.42336981712888, 12);
    expect(latitudeForRasterRow(1, 3, minLat, maxLat)).not.toBeCloseTo((minLat + maxLat) / 2, 4);
  });

  it("normalizes coverage colors against the RX target instead of sample min/max", () => {
    const scale = { min: -150, max: -90 };
    expect(normalizeCoverageDbmForRxTarget(-150, -120, scale)).toBe(0);
    expect(normalizeCoverageDbmForRxTarget(-120, -120, scale)).toBeCloseTo(0.5, 4);
    expect(normalizeCoverageDbmForRxTarget(-90, -120, scale)).toBe(1);
  });

  it("centers the RX target scale while widening to observed signal distribution", () => {
    const scale = computeCoverageRxTargetScale(
      [
        { lat: 0, lon: 0, valueDbm: -150 },
        { lat: 0, lon: 1, valueDbm: -190 },
        { lat: 1, lon: 0, valueDbm: -125 },
        { lat: 1, lon: 1, valueDbm: -85 },
      ],
      -120,
    );

    expect(scale).toEqual({ min: -175, max: -65 });
  });

  it("reports the target-centered heatmap scale for the legend", async () => {
    const raster = await buildCoverageOverlayPixelsAsync(
      bounds,
      samples,
      "heatmap",
      5,
      { width: 16, height: 10 },
      undefined,
      terrainSampler,
      { phase: "coverage", signature: "legend-scale-test" },
      { rxTargetDbm: -100 },
    );

    expect(raster?.minDbm).toBeCloseTo(-125, 4);
    expect(raster?.maxDbm).toBeCloseTo(-75, 4);
  });

  it("builds coverage raster pixels with expected metadata shape", async () => {
    const raster = await buildCoverageOverlayPixelsAsync(
      bounds,
      samples,
      "heatmap",
      5,
      { width: 16, height: 10 },
      undefined,
      terrainSampler,
      { phase: "coverage", signature: "shape-test" },
    );

    expect(raster).not.toBeNull();
    expect(raster?.width).toBe(16);
    expect(raster?.height).toBe(10);
    expect(raster?.pixels.length).toBe(16 * 10 * 4);
    expect(raster?.coordinates).toEqual([
      [bounds.minLon, bounds.maxLat],
      [bounds.maxLon, bounds.maxLat],
      [bounds.maxLon, bounds.minLat],
      [bounds.minLon, bounds.minLat],
    ]);
  });

  it("draws contour pixels only near the RX target threshold", async () => {
    const raster = await buildCoverageOverlayPixelsAsync(
      bounds,
      [
        { lat: 59.8, lon: 10.6, valueDbm: -130 },
        { lat: 59.8, lon: 10.8, valueDbm: -110 },
        { lat: 60.0, lon: 10.6, valueDbm: -130 },
        { lat: 60.0, lon: 10.8, valueDbm: -110 },
      ],
      "contours",
      5,
      { width: 24, height: 8 },
      undefined,
      terrainSampler,
      { phase: "coverage", signature: "target-contour-test" },
      { rxTargetDbm: -120 },
    );

    expect(raster).not.toBeNull();
    const alphas = Array.from(raster!.pixels).filter((_, index) => index % 4 === 3);
    const visiblePixels = alphas.filter((alpha) => alpha > 0).length;
    expect(visiblePixels).toBeGreaterThan(0);
    expect(visiblePixels).toBeLessThan(alphas.length / 2);
  });

  it("supports all overlay modes through async chunked builders", async () => {
    const passFail = await buildSourcePassFailOverlayPixelsAsync(
      bounds,
      fromSite,
      link,
      toSite.antennaHeightM,
      toSite.rxGainDbi,
      environment,
      -118,
      0,
      terrainSampler,
      { width: 10, height: 10 },
      24,
      undefined,
      { phase: "passfail", signature: "mode-passfail", frameBudgetMs: 2 },
    );

    const relay = await buildRelayCandidateOverlayPixelsAsync(
      bounds,
      fromSite,
      toSite,
      link,
      environment,
      0,
      terrainSampler,
      { width: 10, height: 10 },
      24,
      undefined,
      { phase: "relay", signature: "mode-relay", frameBudgetMs: 2 },
    );

    const terrain = await buildTerrainShadeOverlayPixelsAsync(
      bounds,
      terrainSampler,
      { width: 10, height: 10 },
      undefined,
      { phase: "terrain", signature: "mode-terrain", frameBudgetMs: 2 },
    );

    expect(passFail?.pixels.length).toBe(10 * 10 * 4);
    expect(relay?.pixels.length).toBe(10 * 10 * 4);
    expect(terrain?.pixels.length).toBe(10 * 10 * 4);
    expect(relay?.minDbm).toEqual(expect.any(Number));
    expect(relay?.maxDbm).toEqual(expect.any(Number));
  });

  it("builds mesh-extension metadata and finds positive newly covered area", async () => {
    const raster = await buildMeshExtensionOverlayPixelsAsync({
      bounds: {
        minLat: 59.89,
        maxLat: 59.91,
        minLon: 10.64,
        maxLon: 10.68,
      },
      selectedSites: [fromSite],
      frequencyMHz: 868,
      propagationEnvironment: environment,
      rxTargetDbm: -70,
      environmentLossDb: 0,
      terrainSampler: () => 100,
      dimensions: { width: 8, height: 6 },
      candidateGridSize: 6,
      coverageGridSize: 6,
      terrainSamples: 16,
      context: { phase: "mesh-extension", signature: "mesh-extension-positive", frameBudgetMs: 2 },
    });

    expect(raster).not.toBeNull();
    expect(raster?.pixels.length).toBe(8 * 6 * 4);
    expect(raster?.minAreaKm2).toBe(0);
    expect(raster?.maxAreaKm2).toBeGreaterThan(0);
    expect(raster?.minDbm).toEqual(expect.any(Number));
    expect(raster?.maxDbm).toEqual(expect.any(Number));
  });

  it("reports zero new area when the selected mesh already covers the comparison grid", async () => {
    const raster = await buildMeshExtensionOverlayPixelsAsync({
      bounds: { minLat: 59.899, maxLat: 59.901, minLon: 10.649, maxLon: 10.651 },
      selectedSites: [fromSite],
      frequencyMHz: 868,
      propagationEnvironment: environment,
      rxTargetDbm: -140,
      environmentLossDb: 0,
      terrainSampler: () => 100,
      dimensions: { width: 6, height: 6 },
      candidateGridSize: 6,
      coverageGridSize: 6,
      terrainSamples: 16,
      context: { phase: "mesh-extension", signature: "mesh-extension-covered", frameBudgetMs: 2 },
    });

    expect(raster?.minAreaKm2).toBe(0);
    expect(raster?.maxAreaKm2).toBe(0);
  });

  it("renders candidates below the bidirectional mesh target fully transparent", async () => {
    const raster = await buildMeshExtensionOverlayPixelsAsync({
      bounds,
      selectedSites: [fromSite],
      frequencyMHz: 868,
      propagationEnvironment: environment,
      rxTargetDbm: -20,
      environmentLossDb: 0,
      terrainSampler,
      dimensions: { width: 8, height: 8 },
      candidateGridSize: 8,
      coverageGridSize: 8,
      terrainSamples: 16,
      context: { phase: "mesh-extension", signature: "mesh-extension-transparent-fail" },
    });

    expect(raster).not.toBeNull();
    expect(Array.from(raster!.pixels).filter((_, index) => index % 4 === 3).every((alpha) => alpha === 0)).toBe(true);
  });

  it("skips quadratic high-resolution area work for candidates that cannot join the mesh", async () => {
    let terrainReads = 0;
    const raster = await buildMeshExtensionOverlayPixelsAsync({
      bounds,
      selectedSites: [fromSite],
      frequencyMHz: 868,
      propagationEnvironment: environment,
      rxTargetDbm: -20,
      environmentLossDb: 0,
      terrainSampler: () => {
        terrainReads += 1;
        return 135;
      },
      dimensions: { width: 8, height: 8 },
      candidateGridSize: 168,
      coverageGridSize: 168,
      terrainSamples: 16,
      context: { phase: "mesh-extension", signature: "mesh-extension-high-resolution-pruning" },
    });

    expect(raster).not.toBeNull();
    expect(terrainReads).toBeLessThan(70_000);
    expect(Array.from(raster!.pixels).filter((_, index) => index % 4 === 3).every((alpha) => alpha === 0)).toBe(true);
  });

  it("uses the production-style Mesh Extension analysis grid and interpolates the display raster", async () => {
    const dimensions = { width: 48, height: 48 };
    const raster = await buildMeshExtensionOverlayPixelsAsync({
      bounds,
      selectedSites: [fromSite],
      frequencyMHz: 868,
      propagationEnvironment: environment,
      rxTargetDbm: -20,
      environmentLossDb: 0,
      terrainSampler,
      dimensions,
      candidateGridSize: 6,
      coverageGridSize: 6,
      terrainSamples: 16,
      context: { phase: "mesh-extension", signature: "mesh-extension-canonical-grid" },
    });

    expect(raster?.width).toBe(dimensions.width);
    expect(raster?.height).toBe(dimensions.height);
    const analysisPoints = computeCoverageGridDimensions(6, bounds).totalSamples;
    expect(raster?.analysisStats?.totalPixels).toBe(analysisPoints);
    expect(raster?.analysisStats?.evaluatedPaths).toBeLessThanOrEqual(analysisPoints);
    expect(Array.from(raster!.pixels).filter((_, index) => index % 4 === 3).every((alpha) => alpha === 0)).toBe(true);
  });

  it("returns no mesh-extension raster when terrain is unavailable", async () => {
    const raster = await buildMeshExtensionOverlayPixelsAsync({
      bounds,
      selectedSites: [fromSite],
      frequencyMHz: 868,
      propagationEnvironment: environment,
      rxTargetDbm: -118,
      environmentLossDb: 0,
      terrainSampler: () => null,
      dimensions: { width: 6, height: 6 },
      candidateGridSize: 6,
      coverageGridSize: 6,
      terrainSamples: 16,
      context: { phase: "mesh-extension", signature: "mesh-extension-no-terrain", frameBudgetMs: 2 },
    });

    expect(raster).toBeNull();
  });

  it("cancels mesh-extension scoring before returning stale pixels", async () => {
    await expect(
      buildMeshExtensionOverlayPixelsAsync({
        bounds,
        selectedSites: [fromSite],
        frequencyMHz: 868,
        propagationEnvironment: environment,
        rxTargetDbm: -118,
        environmentLossDb: 0,
        terrainSampler,
        dimensions: { width: 12, height: 12 },
        candidateGridSize: 12,
        coverageGridSize: 12,
        terrainSamples: 16,
        context: {
          phase: "mesh-extension",
          signature: "mesh-extension-cancelled",
          shouldCancel: () => true,
        },
      }),
    ).rejects.toBeInstanceOf(OverlayTaskCancelledError);
  });

  it("reports monotonic aggregate progress across mesh-extension stages", async () => {
    const progress: number[] = [];
    await buildMeshExtensionOverlayPixelsAsync({
      bounds: { minLat: 59.899, maxLat: 59.901, minLon: 10.649, maxLon: 10.651 },
      selectedSites: [fromSite],
      frequencyMHz: 868,
      propagationEnvironment: environment,
      rxTargetDbm: -120,
      environmentLossDb: 0,
      terrainSampler,
      dimensions: { width: 6, height: 6 },
      candidateGridSize: 6,
      coverageGridSize: 6,
      terrainSamples: 16,
      context: {
        phase: "mesh-extension",
        signature: "mesh-extension-progress",
        onProgress: ({ percent }) => progress.push(percent),
      },
    });

    expect(progress.at(-1)).toBe(100);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  });

  it("cancels an in-flight overlay task without returning stale data", async () => {
    let shouldCancel = false;
    const promise = buildCoverageOverlayPixelsAsync(
      bounds,
      samples,
      "contours",
      5,
      { width: 220, height: 220 },
      undefined,
      terrainSampler,
      {
        phase: "coverage",
        signature: "cancel-test",
        frameBudgetMs: 1,
        longTaskMs: 1,
        shouldCancel: () => shouldCancel,
        onLongTask: () => {
          shouldCancel = true;
        },
      },
    );

    await expect(promise).rejects.toBeInstanceOf(OverlayTaskCancelledError);
  });

  it("reports cooperative progress for overlay build callbacks", async () => {
    const checkpoints: Array<{ processed: number; total: number; percent: number }> = [];
    await buildCoverageOverlayPixelsAsync(
      bounds,
      samples,
      "heatmap",
      5,
      { width: 40, height: 40 },
      undefined,
      terrainSampler,
      {
        phase: "coverage",
        signature: "progress-test",
        frameBudgetMs: 1,
        onProgress: (payload) => {
          checkpoints.push({
            processed: payload.processed,
            total: payload.total,
            percent: payload.percent,
          });
        },
      },
    );

    expect(checkpoints.length).toBeGreaterThan(0);
    const last = checkpoints[checkpoints.length - 1];
    expect(last).toEqual({ processed: 1600, total: 1600, percent: 100 });
  });
});
