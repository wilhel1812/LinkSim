import type { MapOverlayMode } from "../store/appStore";

export type DeepLinkPayloadV1 = {
  version: 1;
  simulationId: string;
  selectedLinkId?: string;
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
  | { ok: false; reason: "missing_sim" | "invalid_sim" | "invalid_version" };

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

export const parseDeepLinkFromLocation = (locationLike: Pick<Location, "search">): DeepLinkParseResult => {
  const params = new URLSearchParams(locationLike.search ?? "");
  const versionRaw = trimToUndefined(params.get("dl"));
  if (versionRaw && versionRaw !== "1") {
    return { ok: false, reason: "invalid_version" };
  }

  const simulationId = trimToUndefined(params.get("sim"));
  if (!simulationId) {
    if (params.has("sim")) return { ok: false, reason: "invalid_sim" };
    return { ok: false, reason: "missing_sim" };
  }

  const selectedLinkId = trimToUndefined(params.get("link"));
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
      simulationId,
      ...(selectedLinkId ? { selectedLinkId } : {}),
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
  const url = new URL(pathname, origin);
  const params = new URLSearchParams();
  params.set("dl", String(payload.version));
  params.set("sim", payload.simulationId);
  if (payload.selectedLinkId) params.set("link", payload.selectedLinkId);
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
