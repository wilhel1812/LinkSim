import type { MapOverlayMode } from "../store/appStore";

export type DeepLinkPayloadV1 = {
  version: 1;
  simulationId?: string;
  simulationSlug?: string;
  selectedLinkId?: string;
  selectedLinkSlug?: string;
  overlayMode?: MapOverlayMode;
  mapViewport?: {
    lat: number;
    lon: number;
    zoom: number;
    bearing?: number;
    pitch?: number;
  };
};

export type DeepLinkParseResult =
  | { ok: true; payload: DeepLinkPayloadV1 }
  | { ok: false; reason: "missing_sim" | "invalid_sim" | "invalid_version" | "invalid_slug" };

const isOverlayMode = (value: string): value is MapOverlayMode =>
  value === "none" ||
  value === "heatmap" ||
  value === "contours" ||
  value === "passfail" ||
  value === "relay";

const parseNumber = (value: string | null): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const trimToUndefined = (value: string | null): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const isReservedPathHead = (head: string): boolean => {
  const value = head.toLowerCase();
  return value === "api" || value === "cdn-cgi" || value === "assets" || value === "meshmap";
};

const normalizeSlugSegment = (value: string): string => value.trim().replace(/^\/+|\/+$/g, "").toLowerCase();

export const slugifyName = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

type DeepLinkLocationLike = Pick<Location, "search"> & { pathname?: string };

export const parseDeepLinkFromLocation = (locationLike: DeepLinkLocationLike): DeepLinkParseResult => {
  const params = new URLSearchParams(locationLike.search ?? "");
  const versionRaw = trimToUndefined(params.get("dl"));
  if (versionRaw && versionRaw !== "1") {
    return { ok: false, reason: "invalid_version" };
  }

  const pathSegments = (locationLike.pathname ?? "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const pathSimulationSlugRaw = pathSegments[0] ?? "";
  const pathSimulationSlug =
    pathSimulationSlugRaw && !isReservedPathHead(pathSimulationSlugRaw)
      ? normalizeSlugSegment(pathSimulationSlugRaw)
      : undefined;
  const pathLinkSlug = pathSegments[1] ? normalizeSlugSegment(pathSegments[1]) : undefined;

  const simulationId = trimToUndefined(params.get("sim"));
  const simulationSlug = trimToUndefined(params.get("sim_slug")) ?? pathSimulationSlug;
  if (!simulationId && !simulationSlug) {
    if (params.has("sim")) return { ok: false, reason: "invalid_sim" };
    return { ok: false, reason: "missing_sim" };
  }
  if (simulationSlug !== undefined && !simulationSlug.length) return { ok: false, reason: "invalid_slug" };

  const selectedLinkId = trimToUndefined(params.get("link"));
  const selectedLinkSlug = trimToUndefined(params.get("link_slug")) ?? pathLinkSlug;
  const overlayRaw = trimToUndefined(params.get("ov"));
  const overlayMode = overlayRaw && isOverlayMode(overlayRaw) ? overlayRaw : undefined;

  const lat = parseNumber(params.get("lat"));
  const lon = parseNumber(params.get("lon"));
  const zoom = parseNumber(params.get("z"));
  const bearing = parseNumber(params.get("b"));
  const pitch = parseNumber(params.get("p"));

  const mapViewport =
    lat !== null && lon !== null && zoom !== null
      ? {
          lat,
          lon,
          zoom,
          ...(bearing !== null ? { bearing } : {}),
          ...(pitch !== null ? { pitch } : {}),
        }
      : undefined;

  return {
    ok: true,
    payload: {
      version: 1,
      ...(simulationId ? { simulationId } : {}),
      ...(simulationSlug ? { simulationSlug } : {}),
      ...(selectedLinkId ? { selectedLinkId } : {}),
      ...(selectedLinkSlug ? { selectedLinkSlug } : {}),
      ...(overlayMode ? { overlayMode } : {}),
      ...(mapViewport ? { mapViewport } : {}),
    },
  };
};

export const buildDeepLinkUrl = (
  payload: DeepLinkPayloadV1,
  origin: string,
  pathname = "/",
): string => {
  const simulationPathSlug = payload.simulationSlug ? slugifyName(payload.simulationSlug) : "";
  const linkPathSlug = payload.selectedLinkSlug ? slugifyName(payload.selectedLinkSlug) : "";
  const pathPrefix = simulationPathSlug ? `/${simulationPathSlug}${linkPathSlug ? `/${linkPathSlug}` : ""}` : pathname;
  const url = new URL(pathPrefix, origin);
  const params = new URLSearchParams();
  params.set("dl", String(payload.version));
  if (payload.simulationId) params.set("sim", payload.simulationId);
  if (!simulationPathSlug && payload.simulationSlug) params.set("sim_slug", payload.simulationSlug);
  if (payload.selectedLinkId) params.set("link", payload.selectedLinkId);
  if (!linkPathSlug && payload.selectedLinkSlug) params.set("link_slug", payload.selectedLinkSlug);
  if (payload.overlayMode) params.set("ov", payload.overlayMode);
  if (payload.mapViewport) {
    params.set("lat", payload.mapViewport.lat.toFixed(6));
    params.set("lon", payload.mapViewport.lon.toFixed(6));
    params.set("z", payload.mapViewport.zoom.toFixed(2));
    if (typeof payload.mapViewport.bearing === "number") params.set("b", payload.mapViewport.bearing.toFixed(2));
    if (typeof payload.mapViewport.pitch === "number") params.set("p", payload.mapViewport.pitch.toFixed(2));
  }
  url.search = params.toString();
  return url.toString();
};
