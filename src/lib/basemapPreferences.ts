export const MAX_CUSTOM_BASEMAP_SOURCES = 20;
export const MAX_BASEMAP_NAME_LENGTH = 80;
export const MAX_BASEMAP_URL_LENGTH = 2048;
export const MAX_BASEMAP_ATTRIBUTION_LENGTH = 300;

export type CustomBasemapSource =
  | {
      id: string;
      name: string;
      kind: "style";
      lightUrl: string;
      darkUrl?: string;
      attribution: string;
      attributionUrl?: string;
    }
  | {
      id: string;
      name: string;
      kind: "raster-xyz";
      lightUrl: string;
      darkUrl?: string;
      attribution: string;
      attributionUrl?: string;
      maxZoom: number;
      tileSize: 256 | 512;
    };

export type UserBasemapPreferences = {
  version: 1;
  customSources: CustomBasemapSource[];
};

export class BasemapPreferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BasemapPreferenceError";
  }
}

const EMPTY_PREFERENCES: UserBasemapPreferences = { version: 1, customSources: [] };

const requireText = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== "string") throw new BasemapPreferenceError(`${label} must be text.`);
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) throw new BasemapPreferenceError(`${label} is required.`);
  if (normalized.length > maxLength) throw new BasemapPreferenceError(`${label} must be ${maxLength} characters or fewer.`);
  return normalized;
};

const normalizeUrl = (value: unknown, label: string, optional = false): string | undefined => {
  if (optional && (value === undefined || value === null || value === "")) return undefined;
  if (typeof value !== "string") throw new BasemapPreferenceError(`${label} must be a URL.`);
  const raw = value.trim();
  if (!raw) {
    if (optional) return undefined;
    throw new BasemapPreferenceError(`${label} is required.`);
  }
  if (raw.length > MAX_BASEMAP_URL_LENGTH) throw new BasemapPreferenceError(`${label} must be ${MAX_BASEMAP_URL_LENGTH} characters or fewer.`);
  let parsed: URL;
  try {
    parsed = new URL(raw.replaceAll("{z}", "0").replaceAll("{x}", "0").replaceAll("{y}", "0"));
  } catch {
    throw new BasemapPreferenceError(`${label} must be a valid HTTP or HTTPS URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BasemapPreferenceError(`${label} must use HTTP or HTTPS.`);
  }
  if (parsed.username || parsed.password) throw new BasemapPreferenceError(`${label} cannot contain embedded credentials.`);
  return raw;
};

const normalizeSource = (value: unknown): CustomBasemapSource => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BasemapPreferenceError("Each custom source must be an object.");
  const raw = value as Record<string, unknown>;
  const id = requireText(raw.id, "Source id", 120);
  if (id.includes(":")) throw new BasemapPreferenceError("Source id cannot contain a colon.");
  const name = requireText(raw.name, "Source name", MAX_BASEMAP_NAME_LENGTH);
  if (raw.kind !== "style" && raw.kind !== "raster-xyz") throw new BasemapPreferenceError("Source kind must be style or raster-xyz.");
  const lightUrl = normalizeUrl(raw.lightUrl, "Light URL")!;
  const darkUrl = normalizeUrl(raw.darkUrl, "Dark URL", true);
  const attribution = requireText(raw.attribution, "Attribution", MAX_BASEMAP_ATTRIBUTION_LENGTH);
  const attributionUrl = normalizeUrl(raw.attributionUrl, "Attribution URL", true);

  if (raw.kind === "style") return { id, name, kind: "style", lightUrl, ...(darkUrl ? { darkUrl } : {}), attribution, ...(attributionUrl ? { attributionUrl } : {}) };
  for (const placeholder of ["{z}", "{x}", "{y}"]) {
    if (!lightUrl.includes(placeholder) || (darkUrl ? !darkUrl.includes(placeholder) : false)) {
      throw new BasemapPreferenceError(`Raster URLs must contain ${placeholder}.`);
    }
  }
  const maxZoom = Number(raw.maxZoom);
  if (!Number.isInteger(maxZoom) || maxZoom < 0 || maxZoom > 24) throw new BasemapPreferenceError("Raster max zoom must be an integer from 0 to 24.");
  if (raw.tileSize !== 256 && raw.tileSize !== 512) throw new BasemapPreferenceError("Raster tile size must be 256 or 512.");
  return { id, name, kind: "raster-xyz", lightUrl, ...(darkUrl ? { darkUrl } : {}), attribution, ...(attributionUrl ? { attributionUrl } : {}), maxZoom, tileSize: raw.tileSize };
};

export const normalizeUserBasemapPreferences = (
  value: unknown,
  options: { strict?: boolean } = {},
): UserBasemapPreferences => {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BasemapPreferenceError("Basemap preferences must be an object.");
    const raw = value as Record<string, unknown>;
    if (raw.version !== 1 || !Array.isArray(raw.customSources)) throw new BasemapPreferenceError("Unsupported basemap preference format.");
    if (raw.customSources.length > MAX_CUSTOM_BASEMAP_SOURCES) throw new BasemapPreferenceError(`You can save up to ${MAX_CUSTOM_BASEMAP_SOURCES} custom sources.`);
    const customSources = raw.customSources.map(normalizeSource);
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const source of customSources) {
      const foldedName = source.name.toLocaleLowerCase();
      if (ids.has(source.id)) throw new BasemapPreferenceError("Custom source ids must be unique.");
      if (names.has(foldedName)) throw new BasemapPreferenceError("Custom source names must be unique.");
      ids.add(source.id);
      names.add(foldedName);
    }
    return { version: 1, customSources };
  } catch (error) {
    if (options.strict) throw error;
    return { ...EMPTY_PREFERENCES, customSources: [] };
  }
};

export const customBasemapStyleId = (sourceId: string): string => `custom:${sourceId}`;
export const customBasemapSourceId = (styleId: string): string | null => styleId.startsWith("custom:") ? styleId.slice("custom:".length) : null;
