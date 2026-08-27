import type { StyleSpecification } from "maplibre-gl";
import { THEMES } from "../themes";
import type { UiColorTheme, UiThemeMode } from "../themes/types";

type Rgba = { r: number; g: number; b: number; a: number };
type Hsla = { h: number; s: number; l: number; a: number };

export type BasemapPaintSnapshotEntry = {
  layerId: string;
  property: string;
  value: unknown;
};

const round = (value: number): number => Math.round(value * 100) / 100;
const channel = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return value.endsWith("%") ? parsed / 100 : parsed / 255;
};
const alpha = (value: string | undefined): number => {
  if (value === undefined) return 1;
  const parsed = Number.parseFloat(value);
  return value.endsWith("%") ? parsed / 100 : parsed;
};

const hslToRgb = ({ h, s, l, a }: Hsla): Rgba => {
  const chroma = (1 - Math.abs((2 * l) - 1)) * s;
  const segment = ((h % 360) + 360) % 360 / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const [r1, g1, b1] = segment < 1 ? [chroma, x, 0]
    : segment < 2 ? [x, chroma, 0]
      : segment < 3 ? [0, chroma, x]
        : segment < 4 ? [0, x, chroma]
          : segment < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const offset = l - (chroma / 2);
  return { r: r1 + offset, g: g1 + offset, b: b1 + offset, a };
};

const rgbToHsl = ({ r, g, b, a }: Rgba): Hsla => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs((2 * l) - 1));
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * (((b - r) / delta) + 2);
    else h = 60 * (((r - g) / delta) + 4);
  }
  return { h: h < 0 ? h + 360 : h, s, l, a };
};

const parseColor = (value: string): Rgba | null => {
  const input = value.trim();
  const hex = input.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
    if (expanded.length === 6 || expanded.length === 8) {
      return {
        r: Number.parseInt(expanded.slice(0, 2), 16) / 255,
        g: Number.parseInt(expanded.slice(2, 4), 16) / 255,
        b: Number.parseInt(expanded.slice(4, 6), 16) / 255,
        a: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
      };
    }
  }

  const rgb = input.match(/^rgba?\(\s*([^,\s]+)[,\s]+([^,\s]+)[,\s]+([^,\s/]+)(?:\s*[,/]\s*([^\s)]+))?\s*\)$/i);
  if (rgb) return { r: channel(rgb[1]), g: channel(rgb[2]), b: channel(rgb[3]), a: alpha(rgb[4]) };

  const hsl = input.match(/^hsla?\(\s*([+-]?[\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:\s*[,/]\s*([^\s)]+))?\s*\)$/i);
  if (hsl) {
    return hslToRgb({
      h: Number.parseFloat(hsl[1]),
      s: Number.parseFloat(hsl[2]) / 100,
      l: Number.parseFloat(hsl[3]) / 100,
      a: alpha(hsl[4]),
    });
  }
  return null;
};

const tintColorString = (value: string, colorTheme: UiColorTheme, theme: UiThemeMode): string => {
  const source = parseColor(value);
  const target = parseColor(THEMES[colorTheme][theme].cssVars["--accent"]);
  if (!source || !target) return value;
  const sourceHsl = rgbToHsl(source);
  if (sourceHsl.h < 185 || sourceHsl.h > 265 || sourceHsl.s < 0.08) return value;
  const targetHsl = rgbToHsl(target);
  const saturation = colorTheme === "neutral" ? Math.min(sourceHsl.s, targetHsl.s) : sourceHsl.s;
  return `hsla(${round(targetHsl.h)}, ${round(saturation * 100)}%, ${round(sourceHsl.l * 100)}%, ${round(sourceHsl.a)})`;
};

export const tintBasemapPaintValue = (
  value: unknown,
  colorTheme: UiColorTheme,
  theme: UiThemeMode,
): unknown => {
  if (typeof value === "string") return tintColorString(value, colorTheme, theme);
  if (Array.isArray(value)) return value.map((entry) => tintBasemapPaintValue(entry, colorTheme, theme));
  return value;
};

export const captureBasemapPaintSnapshot = (style: StyleSpecification): BasemapPaintSnapshotEntry[] =>
  style.layers.flatMap((layer) => {
    if (layer.id.startsWith("linksim-") || !("paint" in layer) || !layer.paint) return [];
    return Object.entries(layer.paint as Record<string, unknown>)
      .filter(([property, value]) => property.endsWith("-color") && value !== undefined)
      .map(([property, value]) => ({ layerId: layer.id, property, value }));
  });

export const resolveBasemapPaintUpdates = (
  snapshot: BasemapPaintSnapshotEntry[],
  enabled: boolean,
  colorTheme: UiColorTheme,
  theme: UiThemeMode,
): BasemapPaintSnapshotEntry[] => snapshot.map((entry) => ({
  ...entry,
  value: enabled ? tintBasemapPaintValue(entry.value, colorTheme, theme) : entry.value,
}));
