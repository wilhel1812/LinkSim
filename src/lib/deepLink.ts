const DELIMITER_CHARS = /[+<>\/]/g;

export type DeepLinkPayloadV2 = {
  version: 2;
  simulationId?: string;
  simulationSlug?: string;
  selectedSiteSlugs?: string[];
  selectedLinkSlugs?: string[];
};

export type DeepLinkParseResult =
  | { ok: true; payload: DeepLinkPayloadV2 }
  | { ok: false; reason: "missing_sim" | "invalid_sim" | "invalid_version" | "invalid_slug" };

const trimToUndefined = (value: string | null): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const isReservedPathHead = (head: string): boolean => {
  const value = head.toLowerCase();
  return value === "api" || value === "cdn-cgi" || value === "assets" || value === "meshmap";
};

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeSlugSegment = (value: string): string =>
  value.trim().replace(/^\/+|\/+$/g, "");

const isV2Path = (pathname: string): boolean => {
  const segments = (pathname ?? "/").split("/").filter(Boolean);
  if (segments.length >= 2) return true;
  if (segments[0]?.includes("+") || segments[0]?.includes("<>")) return true;
  if (segments[0]) return true;
  return false;
};

export const slugifyName = (value: string): string =>
  value
    .trim()
    .normalize("NFKC")
    .replace(DELIMITER_CHARS, "")
    .normalize("NFKD")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

export const canonicalizeDeepLinkKey = (value: string): string =>
  safeDecodeURIComponent(value)
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

const parseV2Path = (pathname: string) => {
  const segments = (pathname ?? "/")
    .split("/")
    .map((s) => s.trim())
    .map((s) => safeDecodeURIComponent(s))
    .filter(Boolean);

  if (!segments.length) return { simulationSlug: undefined, selection: undefined };

  const simulationSlugRaw = segments[0];
  if (isReservedPathHead(simulationSlugRaw)) {
    return { simulationSlug: undefined, selection: undefined };
  }

  const simulationSlug = normalizeSlugSegment(simulationSlugRaw);
  if (!simulationSlug) return { simulationSlug: undefined, selection: undefined };

  if (segments.length === 1) {
    return { simulationSlug, selection: undefined };
  }

  const selectionPart = segments.slice(1).join("/");

  if (selectionPart.includes("<>")) {
    const [fromSlug, toSlug] = selectionPart.split("<>").map(normalizeSlugSegment);
    return {
      simulationSlug,
      selection: { type: "link", fromSlug: fromSlug ?? "", toSlug: toSlug ?? "" },
    };
  }

  const siteSlugs = selectionPart.split("+").map(normalizeSlugSegment).filter(Boolean);
  if (siteSlugs.length >= 1) {
    return { simulationSlug, selection: { type: "sites", siteSlugs } };
  }

  return { simulationSlug, selection: undefined };
};

export const parseDeepLinkFromLocation = (locationLike: DeepLinkLocationLike): DeepLinkParseResult => {
  const params = new URLSearchParams(locationLike.search ?? "");
  const versionRaw = trimToUndefined(params.get("dl"));

  if (versionRaw === "1") {
    const simulationId = trimToUndefined(params.get("sim"));
    const simulationSlug = trimToUndefined(params.get("sim_slug"));
    const selectedLinkSlug = trimToUndefined(params.get("link_slug"));

    if (!simulationId && !simulationSlug) {
      if (params.has("sim")) return { ok: false, reason: "invalid_sim" };
      return { ok: false, reason: "missing_sim" };
    }

    return {
      ok: true,
      payload: {
        version: 2,
        simulationId,
        simulationSlug,
        ...(selectedLinkSlug ? { selectedLinkSlugs: [selectedLinkSlug] } : {}),
      },
    };
  }

  const isV2Format = versionRaw === "2" || isV2Path(locationLike.pathname ?? "/");

  if (versionRaw && versionRaw !== "2") {
    return { ok: false, reason: "invalid_version" };
  }

  if (!isV2Format) {
    const simulationId = trimToUndefined(params.get("sim"));
    if (!simulationId) {
      if (params.has("sim")) return { ok: false, reason: "invalid_sim" };
      return { ok: false, reason: "missing_sim" };
    }
    return {
      ok: true,
      payload: {
        version: 2,
        simulationId,
      },
    };
  }

  const { simulationSlug: pathSimulationSlug, selection } = parseV2Path(locationLike.pathname ?? "/");

  const simulationId = trimToUndefined(params.get("sim"));
  const simulationSlug = trimToUndefined(params.get("sim_slug")) ?? pathSimulationSlug;

  if (!simulationId && !simulationSlug) {
    if (params.has("sim")) return { ok: false, reason: "invalid_sim" };
    return { ok: false, reason: "missing_sim" };
  }
  if (simulationSlug !== undefined && !simulationSlug.length) return { ok: false, reason: "invalid_slug" };

  if (selection?.type === "link") {
    const linkSlugs = [selection.fromSlug, selection.toSlug].filter(Boolean) as string[];
    return {
      ok: true,
      payload: {
        version: 2,
        simulationId,
        simulationSlug,
        selectedLinkSlugs: linkSlugs,
      },
    };
  }

  if (selection?.type === "sites") {
    return {
      ok: true,
      payload: {
        version: 2,
        simulationId,
        simulationSlug,
        selectedSiteSlugs: selection.siteSlugs,
      },
    };
  }

  return {
    ok: true,
    payload: {
      version: 2,
      simulationId,
      simulationSlug,
    },
  };
};

export const buildDeepLinkUrl = (
  payload: DeepLinkPayloadV2,
  origin: string,
  pathname = "/",
): string => {
  const simulationSlug = payload.simulationSlug ?? "";
  const pathSlug = slugifyName(simulationSlug);

  if (!pathSlug) {
    const url = new URL(pathname, origin);
    if (payload.simulationId) url.searchParams.set("sim", payload.simulationId);
    if (payload.simulationSlug) url.searchParams.set("sim_slug", payload.simulationSlug);
    return url.toString();
  }

  const cleanSlug = (s: string) =>
    s.replace(DELIMITER_CHARS, "").replace(/\s+/g, "-").replace(/-+/g, "-");

  let pathPart = `/${cleanSlug(pathSlug)}`;

  if (payload.selectedLinkSlugs && payload.selectedLinkSlugs.length === 2) {
    const [from, to] = payload.selectedLinkSlugs;
    pathPart += `/${cleanSlug(from)}<>${cleanSlug(to)}`;
  } else if (payload.selectedSiteSlugs && payload.selectedSiteSlugs.length > 0) {
    const sitePath = payload.selectedSiteSlugs.map(cleanSlug).join("+");
    pathPart += `/${sitePath}`;
  }

  return `${origin}${pathPart}`;
};
