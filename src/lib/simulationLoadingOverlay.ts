import { latitudeForRasterRow, type TerrainBounds } from "./overlayRaster";
import { interpolateHeatmapColor } from "../themes/heatmapColors";

const MAX_CANVAS_DIMENSION = 192;
const MIN_CANVAS_DIMENSION = 48;
const CLOUD_CYCLE_MS = 2_400;
const CLOUD_ALPHA = 178;
export const LOADING_OVERLAY_EXIT_MS = 500;

export type LoadingOverlayCoordinates = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

export type DriftingCloudFrame = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  latByRow: Float64Array;
  lonByColumn: Float64Array;
};

export type DriftingCloudFrameInput = {
  bounds: TerrainBounds;
  width: number;
  height: number;
  phase: number;
  pointMask: (lat: number, lon: number) => boolean;
};

export type SimulationOverlayTransition = {
  coverageOpacity: number;
  loadingOpacity: number;
  durationMs: number;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const mercatorYDegrees = (lat: number): number => {
  const normalized = clamp(lat, -85.05112878, 85.05112878);
  const radians = (normalized * Math.PI) / 180;
  return (Math.log(Math.tan(Math.PI / 4 + radians / 2)) * 180) / Math.PI;
};

export const loadingOverlayCoordinates = (
  bounds: TerrainBounds,
): LoadingOverlayCoordinates => [
  [bounds.minLon, bounds.maxLat],
  [bounds.maxLon, bounds.maxLat],
  [bounds.maxLon, bounds.minLat],
  [bounds.minLon, bounds.minLat],
];

export const resolveLoadingOverlayDimensions = (
  bounds: TerrainBounds,
): { width: number; height: number } => {
  const lonSpan = Math.max(1e-6, Math.abs(bounds.maxLon - bounds.minLon));
  const mercatorLatSpan = Math.max(
    1e-6,
    Math.abs(mercatorYDegrees(bounds.maxLat) - mercatorYDegrees(bounds.minLat)),
  );
  const aspectRatio = lonSpan / mercatorLatSpan;
  if (aspectRatio >= 1) {
    return {
      width: MAX_CANVAS_DIMENSION,
      height: clamp(
        Math.round(MAX_CANVAS_DIMENSION / aspectRatio),
        MIN_CANVAS_DIMENSION,
        MAX_CANVAS_DIMENSION,
      ),
    };
  }
  return {
    width: clamp(
      Math.round(MAX_CANVAS_DIMENSION * aspectRatio),
      MIN_CANVAS_DIMENSION,
      MAX_CANVAS_DIMENSION,
    ),
    height: MAX_CANVAS_DIMENSION,
  };
};

export const resolveDriftingCloudPhase = (
  elapsedMs: number,
  reducedMotion: boolean,
): number => {
  if (reducedMotion) return 0;
  return (Math.max(0, elapsedMs) / CLOUD_CYCLE_MS) * Math.PI * 2;
};

export const resolveSimulationOverlayTransition = (
  loading: boolean,
): SimulationOverlayTransition =>
  loading
    ? {
        coverageOpacity: 0,
        loadingOpacity: 0.68,
        durationMs: 350,
      }
    : {
        coverageOpacity: 0.68,
        loadingOpacity: 0,
        durationMs: LOADING_OVERLAY_EXIT_MS,
      };

const cloudStrength = (x: number, y: number, phase: number): number => {
  const broad =
    Math.sin(x * 6.1 + phase) * 0.17 +
    Math.cos(y * 7.4 - phase * 0.72) * 0.14;
  const diagonal =
    Math.sin((x + y) * 5.2 + phase * 0.43) * 0.11 +
    Math.cos((x - y) * 8.3 - phase * 0.31) * 0.08;
  return clamp(0.58 + broad + diagonal, 0, 1);
};

export const buildDriftingCloudPixels = (
  input: DriftingCloudFrameInput,
): DriftingCloudFrame => {
  const width = Math.max(1, Math.round(input.width));
  const height = Math.max(1, Math.round(input.height));
  const pixels = new Uint8ClampedArray(width * height * 4);
  const latByRow = new Float64Array(height);
  const lonByColumn = new Float64Array(width);
  const lonSpan = input.bounds.maxLon - input.bounds.minLon;
  const widthDivisor = Math.max(1, width - 1);
  const heightDivisor = Math.max(1, height - 1);

  for (let row = 0; row < height; row += 1) {
    latByRow[row] = latitudeForRasterRow(
      row,
      height,
      input.bounds.minLat,
      input.bounds.maxLat,
    );
  }
  for (let column = 0; column < width; column += 1) {
    lonByColumn[column] =
      input.bounds.minLon + lonSpan * (column / widthDivisor);
  }

  for (let row = 0; row < height; row += 1) {
    const lat = latByRow[row];
    const y = row / heightDivisor;
    for (let column = 0; column < width; column += 1) {
      const lon = lonByColumn[column];
      if (!input.pointMask(lat, lon)) continue;
      const x = column / widthDivisor;
      const color = interpolateHeatmapColor(
        cloudStrength(x, y, input.phase),
      );
      const offset = (row * width + column) * 4;
      pixels[offset] = color.r;
      pixels[offset + 1] = color.g;
      pixels[offset + 2] = color.b;
      pixels[offset + 3] = CLOUD_ALPHA;
    }
  }

  return {
    width,
    height,
    pixels,
    latByRow,
    lonByColumn,
  };
};
