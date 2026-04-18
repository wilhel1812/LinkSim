// ---------------------------------------------------------------------------
// Export layout — maps preset names to concrete page & slot geometry
// (all values are output SVG user-units; 1 unit ≈ 0.5 CSS px at 2× density).
// ---------------------------------------------------------------------------

export type SnapshotDimensions = "auto" | "16:9" | "1:1" | "9:16";

export type SlotRect = { x: number; y: number; w: number; h: number };

export type ExportLayout = {
  pageW: number;
  pageH: number;
  /** Area occupied by the map raster (always present). */
  mapSlot: SlotRect;
  /** Area below the map for the profile/panorama strip (null when not shown). */
  profileSlot: SlotRect | null;
  /** Bottom strip with URL footer text (null when not shown). */
  footerSlot: SlotRect | null;
};

const FOOTER_H = 64;

type BuildLayoutOptions = {
  preset: SnapshotDimensions;
  hasProfile: boolean;
  hasFooter: boolean;
};

export function buildExportLayout({ preset, hasProfile, hasFooter }: BuildLayoutOptions): ExportLayout {
  const footerH = hasFooter ? FOOTER_H : 0;

  if (preset === "auto") {
    const pageW = 2400;
    const mapH = Math.round(pageW * (9 / 16)); // 16:9 map
    const profileH = hasProfile ? 560 : 0;
    const pageH = mapH + profileH + footerH;
    return {
      pageW,
      pageH,
      mapSlot: { x: 0, y: 0, w: pageW, h: mapH },
      profileSlot: hasProfile ? { x: 0, y: mapH, w: pageW, h: profileH } : null,
      footerSlot: hasFooter ? { x: 0, y: mapH + profileH, w: pageW, h: footerH } : null,
    };
  }

  let pageW: number;
  let pageH: number;

  switch (preset) {
    case "16:9":
      pageW = 3840;
      pageH = 2160;
      break;
    case "1:1":
      pageW = 2400;
      pageH = 2400;
      break;
    case "9:16":
      pageW = 2160;
      pageH = 3840;
      break;
    default:
      pageW = 2400;
      pageH = 1350;
  }

  // For fixed presets, carve profile + footer from the bottom of the page.
  const profileH = hasProfile ? Math.round(pageH * 0.18) : 0;
  const reservedH = profileH + footerH;
  const mapH = pageH - reservedH;

  return {
    pageW,
    pageH,
    mapSlot: { x: 0, y: 0, w: pageW, h: mapH },
    profileSlot: hasProfile ? { x: 0, y: mapH, w: pageW, h: profileH } : null,
    footerSlot: hasFooter ? { x: 0, y: mapH + profileH, w: pageW, h: footerH } : null,
  };
}
