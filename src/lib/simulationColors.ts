import { classifyPassFailState, computeSourceCentricRxMetrics, type PassFailState } from "./passFailState";
import { deriveDynamicPropagationEnvironment } from "./propagationEnvironment";
import type { Link, PropagationEnvironment, Site } from "../types/radio";

export type LinkColorMode = "manual" | "auto";

export const DEFAULT_LINK_COLOR_MODE: LinkColorMode = "manual";
export const MAP_CONTRAST_DARK = "#000000";
export const MAP_CONTRAST_LIGHT = "#ffffff";

export const SIMULATION_COLOR_PRESETS = [
  { label: "Red", value: "#dc2626" },
  { label: "Orange", value: "#ea580c" },
  { label: "Yellow", value: "#ca8a04" },
  { label: "Green", value: "#16a34a" },
  { label: "Blue", value: "#2563eb" },
  { label: "Purple", value: "#7c3aed" },
] as const;

const SHORT_HEX = /^#([0-9a-f]{3})$/i;
const LONG_HEX = /^#([0-9a-f]{6})$/i;

export const normalizeSimulationColor = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const short = trimmed.match(SHORT_HEX)?.[1];
  if (short) return `#${short.split("").map((entry) => `${entry}${entry}`).join("")}`.toLowerCase();
  const long = trimmed.match(LONG_HEX)?.[1];
  return long ? `#${long.toLowerCase()}` : null;
};

export const normalizeLinkColorMode = (value: unknown): LinkColorMode =>
  value === "auto" ? "auto" : DEFAULT_LINK_COLOR_MODE;

export const normalizeSiteIconColors = (
  value: unknown,
  siteIds: readonly string[],
): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowedIds = new Set(siteIds);
  const normalized: Record<string, string> = {};
  for (const [siteId, colorValue] of Object.entries(value)) {
    if (!allowedIds.has(siteId)) continue;
    const color = normalizeSimulationColor(colorValue);
    if (color) normalized[siteId] = color;
  }
  return normalized;
};

export const classifyAutoLinkState = ({
  rxDbm,
  environmentLossDb,
  rxSensitivityTargetDbm,
  terrainObstructed,
}: {
  rxDbm: number;
  environmentLossDb: number;
  rxSensitivityTargetDbm: number;
  terrainObstructed: boolean;
}): PassFailState =>
  classifyPassFailState(rxDbm - environmentLossDb >= rxSensitivityTargetDbm, terrainObstructed);

export const resolveAutoLinkStateForLink = ({
  link,
  sites,
  reversed,
  environmentLossDb,
  rxSensitivityTargetDbm,
  propagationEnvironment,
  autoPropagationEnvironment,
  terrainSampler,
}: {
  link: Link;
  sites: readonly Site[];
  reversed: boolean;
  environmentLossDb: number;
  rxSensitivityTargetDbm: number;
  propagationEnvironment: PropagationEnvironment;
  autoPropagationEnvironment: boolean;
  terrainSampler: (lat: number, lon: number) => number | null;
}): PassFailState | null => {
  const storedFrom = sites.find((site) => site.id === link.fromSiteId);
  const storedTo = sites.find((site) => site.id === link.toSiteId);
  if (!storedFrom || !storedTo) return null;
  const fromSite = reversed ? storedTo : storedFrom;
  const toSite = reversed ? storedFrom : storedTo;
  if (terrainSampler(toSite.position.lat, toSite.position.lon) === null) return null;
  const effectiveEnvironment = autoPropagationEnvironment
    ? deriveDynamicPropagationEnvironment({
        from: fromSite.position,
        to: toSite.position,
        fromGroundM: fromSite.groundElevationM,
        toGroundM: toSite.groundElevationM,
        terrainSampler: ({ lat, lon }) => terrainSampler(lat, lon),
      }).environment
    : propagationEnvironment;
  const metrics = computeSourceCentricRxMetrics(
    toSite.position.lat,
    toSite.position.lon,
    fromSite,
    link,
    toSite.antennaHeightM,
    toSite.rxGainDbi,
    terrainSampler,
    24,
    effectiveEnvironment,
  );
  return classifyAutoLinkState({
    rxDbm: metrics.rxDbm,
    environmentLossDb,
    rxSensitivityTargetDbm,
    terrainObstructed: metrics.terrainObstructed,
  });
};

const mixHexColors = (first: string, second: string, firstWeight: number): string => {
  const a = normalizeSimulationColor(first);
  const b = normalizeSimulationColor(second);
  if (!a || !b) return a ?? b ?? "#808080";
  const weight = Math.max(0, Math.min(1, firstWeight));
  const channels = [1, 3, 5].map((offset) => {
    const firstChannel = Number.parseInt(a.slice(offset, offset + 2), 16);
    const secondChannel = Number.parseInt(b.slice(offset, offset + 2), 16);
    return Math.round(firstChannel * weight + secondChannel * (1 - weight))
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
};

export const resolveAutoLinkStateColor = (
  state: PassFailState,
  colors: { success: string; warning: string; danger: string },
): string => {
  switch (state) {
    case "pass_clear":
      return colors.success;
    case "pass_blocked":
      return colors.warning;
    case "fail_clear":
      return mixHexColors(colors.warning, colors.danger, 0.45);
    case "fail_blocked":
      return colors.danger;
  }
};
