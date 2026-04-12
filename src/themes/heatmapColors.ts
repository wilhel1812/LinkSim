export type Rgb = { r: number; g: number; b: number };

export const HEATMAP_STOPS: Array<{ v: number; c: Rgb }> = [
  { v: 0, c: { r: 105, g: 42, b: 45 } },
  { v: 0.35, c: { r: 156, g: 63, b: 49 } },
  { v: 0.45, c: { r: 201, g: 92, b: 45 } },
  { v: 0.55, c: { r: 226, g: 127, b: 45 } },
  { v: 0.65, c: { r: 218, g: 175, b: 55 } },
  { v: 0.75, c: { r: 164, g: 193, b: 68 } },
  { v: 0.85, c: { r: 95, g: 178, b: 95 } },
  { v: 1, c: { r: 64, g: 150, b: 178 } },
];

export const interpolateHeatmapColor = (t: number): Rgb => {
  const normalized = Math.max(0, Math.min(1, t));
  if (normalized <= HEATMAP_STOPS[0].v) return HEATMAP_STOPS[0].c;
  if (normalized >= HEATMAP_STOPS[HEATMAP_STOPS.length - 1].v) return HEATMAP_STOPS[HEATMAP_STOPS.length - 1].c;
  for (let i = 0; i < HEATMAP_STOPS.length - 1; i += 1) {
    const a = HEATMAP_STOPS[i];
    const b = HEATMAP_STOPS[i + 1];
    if (normalized < a.v || normalized > b.v) continue;
    const ratio = (normalized - a.v) / (b.v - a.v);
    return {
      r: Math.round(a.c.r + (b.c.r - a.c.r) * ratio),
      g: Math.round(a.c.g + (b.c.g - a.c.g) * ratio),
      b: Math.round(a.c.b + (b.c.b - a.c.b) * ratio),
    };
  }
  return HEATMAP_STOPS[HEATMAP_STOPS.length - 1].c;
};