export type PanoramaLabelSource = "poi" | "peak";

export type PanoramaLabelCandidate = {
  id: string;
  source: PanoramaLabelSource;
  name: string;
  x: number;
  y: number;
  distanceKm: number;
  priorityBucket: 0 | 1;
};

export type PanoramaLabelLayout = PanoramaLabelCandidate & {
  anchorX: number;
  anchorY: number;
  lineStartY: number;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const projectedLabelWidthPx = (name: string): number => {
  const chars = Math.max(4, Math.min(36, name.trim().length || 4));
  return chars * 5.6 + 16;
};

// Labels are rendered at 45°. The horizontal footprint of a rotated rectangle
// with width W and height H is (W + H) / sqrt(2), not W.
const LABEL_TEXT_HEIGHT_PX = 14;
const rotatedHorizontalFootprint = (width: number): number =>
  (width + LABEL_TEXT_HEIGHT_PX) / Math.SQRT2;

export const resolveVisiblePanoramaLabels = (params: {
  candidates: PanoramaLabelCandidate[];
  chartWidth: number;
  leftPadding: number;
  rightPadding: number;
  topY: number;
  minGapPx?: number;
}): PanoramaLabelLayout[] => {
  const { candidates, chartWidth, leftPadding, rightPadding, topY } = params;
  const minGapPx = Math.max(4, params.minGapPx ?? 4);
  const laneLeft = leftPadding + 2;
  const laneRight = chartWidth - rightPadding - 2;
  const laneWidth = Math.max(1, laneRight - laneLeft);
  // Use rotated footprint for hard cap: avg label ~100px wide → ~81px rotated footprint
  const hardCap = Math.max(1, Math.floor(laneWidth / 40));

  const selected: Array<PanoramaLabelLayout & { minX: number; maxX: number }> = [];
  const ranked = [...candidates].sort((a, b) => {
    if (a.priorityBucket !== b.priorityBucket) return a.priorityBucket - b.priorityBucket;
    if (Math.abs(a.distanceKm - b.distanceKm) > 0.0001) return a.distanceKm - b.distanceKm;
    return a.name.localeCompare(b.name);
  });

  for (const candidate of ranked) {
    if (selected.length >= hardCap) break;
    const width = projectedLabelWidthPx(candidate.name);
    const footprint = rotatedHorizontalFootprint(width);
    const anchorX = clamp(candidate.x, laneLeft + footprint * 0.5, laneRight - footprint * 0.5);
    const minX = anchorX - footprint * 0.5;
    const maxX = anchorX + footprint * 0.5;
    const collides = selected.some((entry) => Math.max(entry.minX, minX) <= Math.min(entry.maxX, maxX) + minGapPx);
    if (collides) continue;
    selected.push({
      ...candidate,
      anchorX,
      anchorY: topY,
      lineStartY: topY + 14,
      minX,
      maxX,
    });
  }

  return selected.map(({ minX: _minX, maxX: _maxX, ...label }) => label);
};
