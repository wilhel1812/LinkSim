import type { Site } from "../types/radio";
import { isSiteIconKey } from "./siteIcons";
import { normalizeSimulationColor } from "./simulationColors";

export type SiteLaunch = {
  site: Partial<Omit<Site, "id" | "position" | "name">> & Pick<Site, "position" | "name">;
  source?: { label: string; url?: string };
  iconColor?: string;
};

const numericFields = {
  groundElevationM: [-Infinity, Infinity],
  antennaHeightM: [0, Infinity],
  txPowerDbm: [-Infinity, Infinity],
  txGainDbi: [-Infinity, Infinity],
  rxGainDbi: [-Infinity, Infinity],
  cableLossDb: [0, Infinity],
  antennaAzimuthDeg: [0, 360],
  antennaTiltDeg: [-90, 90],
  antennaHorizontalBeamwidthDeg: [1, 180],
  antennaVerticalBeamwidthDeg: [1, 180],
  antennaMaxAttenuationDb: [0, 60],
} as const;

const decimal = (value: string | null): number =>
  value !== null && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : NaN;

export const httpsSourceUrl = (value: string): URL | undefined => {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && /^https:\/\//i.test(value)) return url;
  } catch {
    return undefined;
  }
};

export function parseSiteLaunch({ pathname, search }: Pick<Location, "pathname" | "search">): SiteLaunch | null | undefined {
  const params = new URLSearchParams(search);
  if (pathname !== "/" || !params.has("site")) return undefined;
  const supported = ["site", "lat", "lon", "name", "description", "source", "sourceUrl",
    "antennaMode", "iconKey", "iconColor", ...Object.keys(numericFields)];
  if (params.get("site") !== "1" || supported.some((key) => params.getAll(key).length > 1)) return null;

  const lat = decimal(params.get("lat"));
  const lon = decimal(params.get("lon"));
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) return null;

  const name = params.get("name")?.trim();
  const description = params.get("description") ?? undefined;
  const label = params.get("source")?.trim();
  const rawUrl = params.get("sourceUrl");
  const url = rawUrl === null ? undefined : httpsSourceUrl(rawUrl);
  if (name === "" || label === "" || (rawUrl !== null && !url)) return null;
  const site: SiteLaunch["site"] = { name: name ?? "Imported Site", description, position: { lat, lon } };
  for (const key of Object.keys(numericFields) as Array<keyof typeof numericFields>) {
    if (!params.has(key)) continue;
    const value = decimal(params.get(key));
    const [min, max] = numericFields[key];
    if (!Number.isFinite(value) || value < min || value > max) return null;
    site[key] = value;
  }
  const mode = params.get("antennaMode");
  if (mode !== null) {
    if (mode !== "omnidirectional" && mode !== "directional") return null;
    site.antennaMode = mode;
  }
  const icon = params.get("iconKey");
  if (icon !== null) {
    if (!isSiteIconKey(icon)) return null;
    site.iconKey = icon;
  }
  const rawColor = params.get("iconColor");
  const iconColor = normalizeSimulationColor(rawColor);
  if (rawColor !== null && !iconColor) return null;
  return {
    site,
    iconColor: iconColor ?? undefined,
    source: label || url ? { label: label ?? url!.hostname, url: url?.href } : undefined,
  };
}
