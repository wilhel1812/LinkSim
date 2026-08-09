export type MapOverlayMode =
  | "none"
  | "heatmap"
  | "contours"
  | "weakest"
  | "passfail"
  | "relay"
  | "mesh-extension";

export const overlayModesForSelectionCount = (
  selectionCount: number,
  siteCount = selectionCount,
): MapOverlayMode[] => {
  if (selectionCount <= 0) {
    return siteCount > 0
      ? ["none", "mesh-extension", "heatmap", "weakest", "contours"]
      : ["none", "heatmap", "weakest", "contours"];
  }
  if (selectionCount === 1) return ["none", "passfail", "mesh-extension", "heatmap", "weakest", "contours"];
  if (selectionCount === 2) return ["none", "relay", "mesh-extension", "heatmap", "weakest", "contours"];
  return ["none", "mesh-extension", "heatmap", "weakest", "contours"];
};

export const overlayGuideTitleForMode = (mode: MapOverlayMode): string => {
  switch (mode) {
    case "none": return "Hidden";
    case "heatmap": return "Heatmap";
    case "contours": return "Heatmap + Target Line";
    case "weakest": return "Weakest Site";
    case "passfail": return "Pass/Fail";
    case "relay": return "Relay";
    case "mesh-extension": return "Mesh Extension";
  }
};

type MeshExtensionSiteDigestInput = Pick<
  import("../types/radio").Site,
  | "id"
  | "position"
  | "groundElevationM"
  | "antennaHeightM"
  | "txPowerDbm"
  | "txGainDbi"
  | "rxGainDbi"
  | "cableLossDb"
  | "antennaMode"
  | "antennaAzimuthDeg"
  | "antennaTiltDeg"
  | "antennaHorizontalBeamwidthDeg"
  | "antennaVerticalBeamwidthDeg"
  | "antennaMaxAttenuationDb"
>;

export const meshExtensionSiteDigest = (sites: MeshExtensionSiteDigestInput[]): string =>
  sites
    .map((site) =>
      [
        site.id,
        site.position.lat,
        site.position.lon,
        site.groundElevationM,
        site.antennaHeightM,
        site.txPowerDbm,
        site.txGainDbi,
        site.rxGainDbi,
        site.cableLossDb,
        site.antennaMode,
        site.antennaAzimuthDeg,
        site.antennaTiltDeg,
        site.antennaHorizontalBeamwidthDeg,
        site.antennaVerticalBeamwidthDeg,
        site.antennaMaxAttenuationDb,
      ].join(":"),
    )
    .join("|");
