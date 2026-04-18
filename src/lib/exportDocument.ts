import type { ExportLayout, SlotRect } from "./exportLayout";
import type { ExportTheme } from "./exportTheme";
import type { PanoramaExportData } from "../components/PanoramaChart";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type ExportDocumentInput = {
  /** Result of MapViewHandle.captureMapSnapshot(). Already includes overlays. */
  mapSnapshot: { dataUrl: string; naturalW: number; naturalH: number } | null;
  /** Normalised [0,1] site positions in the map viewport. */
  siteProjections: Array<{ id: string; name: string; normX: number; normY: number }>;
  /**
   * Profile panel content:
   * - "panorama": raster terrain canvas + optional vector labels.
   * - "linkprofile": fully inline-styled SVGSVGElement from getResolvedSvgElement().
   */
  profileContent:
    | { type: "panorama"; data: PanoramaExportData }
    | { type: "linkprofile"; svgEl: SVGSVGElement }
    | null;
  /** URL to display in the footer, or null to omit footer text. */
  footerUrl: string | null;
};

// ---------------------------------------------------------------------------
// SVG namespace helpers
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

function el<T extends SVGElement>(tag: string, attrs: Record<string, string | number> = {}): T {
  const node = document.createElementNS(SVG_NS, tag) as T;
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, String(v));
  }
  return node;
}

function rect(attrs: Record<string, string | number>): SVGRectElement {
  return el<SVGRectElement>("rect", attrs);
}

function image(attrs: Record<string, string | number> & { href?: string }): SVGImageElement {
  const node = el<SVGImageElement>("image", attrs);
  if (attrs.href) {
    // Use both href (SVG 2) and xlink:href (SVG 1.1) for broadest compat.
    node.setAttribute("href", attrs.href);
    node.setAttributeNS(XLINK_NS, "xlink:href", attrs.href);
  }
  return node;
}

function text(
  content: string,
  attrs: Record<string, string | number>,
): SVGTextElement {
  const node = el<SVGTextElement>("text", attrs);
  node.textContent = content;
  return node;
}

function line(attrs: Record<string, string | number>): SVGLineElement {
  return el<SVGLineElement>("line", attrs);
}

// ---------------------------------------------------------------------------
// buildExportSvg
// ---------------------------------------------------------------------------

/**
 * Builds a complete export SVG document element from the collected input data,
 * layout geometry, and resolved theme. The returned element is detached from
 * the DOM; append to document.body temporarily if you need computed styles
 * (e.g. for svg2pdf.js).
 */
export function buildExportSvg(
  input: ExportDocumentInput,
  layout: ExportLayout,
  theme: ExportTheme,
): SVGSVGElement {
  const { pageW, pageH, mapSlot, profileSlot, footerSlot } = layout;
  const { mapSnapshot, siteProjections, profileContent, footerUrl } = input;

  // Root SVG element
  const root = el<SVGSVGElement>("svg", {
    xmlns: SVG_NS,
    width: pageW,
    height: pageH,
    viewBox: `0 0 ${pageW} ${pageH}`,
  });
  root.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:xlink", XLINK_NS);

  // Page background
  root.appendChild(rect({ x: 0, y: 0, width: pageW, height: pageH, fill: theme.bg }));

  // -------------------------------------------------------------------------
  // Map section
  // -------------------------------------------------------------------------

  if (mapSnapshot) {
    const mapImg = image({
      href: mapSnapshot.dataUrl,
      x: mapSlot.x,
      y: mapSlot.y,
      width: mapSlot.w,
      height: mapSlot.h,
      preserveAspectRatio: "xMidYMid slice",
    });
    root.appendChild(mapImg);
  }

  // Site markers (vector, positioned using normalised viewport coords)
  if (siteProjections.length > 0) {
    const markersG = el<SVGGElement>("g", { id: "site-markers" });
    const RADIUS = Math.max(10, Math.round(mapSlot.w * 0.004)); // ~0.4% of width
    const FONT_SIZE = Math.round(RADIUS * 1.6);

    for (const site of siteProjections) {
      const cx = mapSlot.x + site.normX * mapSlot.w;
      const cy = mapSlot.y + site.normY * mapSlot.h;

      const markerG = el<SVGGElement>("g");

      // Outer ring with link color
      markerG.appendChild(
        el("circle", {
          cx,
          cy,
          r: RADIUS + 3,
          fill: theme.linkColor,
          opacity: "0.9",
        }),
      );
      // White inner dot
      markerG.appendChild(
        el("circle", {
          cx,
          cy,
          r: RADIUS,
          fill: "#ffffff",
        }),
      );

      // Name label (paint-order stroke for legibility on any background)
      const nameLabel = text(site.name, {
        x: cx,
        y: cy - RADIUS - 6,
        "font-family": "system-ui, -apple-system, sans-serif",
        "font-size": FONT_SIZE,
        "font-weight": "600",
        fill: theme.text,
        "text-anchor": "middle",
        "dominant-baseline": "auto",
        "paint-order": "stroke",
        stroke: theme.bg,
        "stroke-width": Math.round(FONT_SIZE * 0.35),
        "stroke-linejoin": "round",
      });
      markerG.appendChild(nameLabel);

      markersG.appendChild(markerG);
    }

    root.appendChild(markersG);
  }

  // -------------------------------------------------------------------------
  // Profile / panorama section
  // -------------------------------------------------------------------------

  if (profileSlot && profileContent) {
    // Panel background
    root.appendChild(
      rect({
        x: profileSlot.x,
        y: profileSlot.y,
        width: profileSlot.w,
        height: profileSlot.h,
        fill: theme.surface,
      }),
    );

    // Divider line between map and profile panel
    root.appendChild(
      line({
        x1: profileSlot.x,
        y1: profileSlot.y,
        x2: profileSlot.x + profileSlot.w,
        y2: profileSlot.y,
        stroke: theme.border,
        "stroke-width": 1,
      }),
    );

    if (profileContent.type === "panorama") {
      buildPanoramaSection(root, profileSlot, profileContent.data, theme);
    } else {
      buildLinkProfileSection(root, profileSlot, profileContent.svgEl);
    }
  }

  // -------------------------------------------------------------------------
  // Footer
  // -------------------------------------------------------------------------

  if (footerSlot && footerUrl) {
    // Footer background
    root.appendChild(
      rect({
        x: footerSlot.x,
        y: footerSlot.y,
        width: footerSlot.w,
        height: footerSlot.h,
        fill: theme.bg,
      }),
    );

    // Top border line
    root.appendChild(
      line({
        x1: footerSlot.x,
        y1: footerSlot.y,
        x2: footerSlot.x + footerSlot.w,
        y2: footerSlot.y,
        stroke: theme.border,
        "stroke-width": 1,
      }),
    );

    const fontSize = Math.round(footerSlot.h * 0.38);
    root.appendChild(
      text(footerUrl, {
        x: footerSlot.x + footerSlot.w / 2,
        y: footerSlot.y + footerSlot.h / 2,
        "font-family": "ui-monospace, 'SF Mono', Menlo, 'Courier New', monospace",
        "font-size": fontSize,
        fill: theme.muted,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
      }),
    );
  }

  return root;
}

// ---------------------------------------------------------------------------
// Panorama section builder
// ---------------------------------------------------------------------------

function buildPanoramaSection(
  root: SVGSVGElement,
  slot: SlotRect,
  data: PanoramaExportData,
  theme: ExportTheme,
): void {
  // Terrain canvas as raster image, preserve aspect ratio with letterboxing.
  const terrainImg = image({
    href: data.terrainDataUrl,
    x: slot.x,
    y: slot.y,
    width: slot.w,
    height: slot.h,
    preserveAspectRatio: "xMidYMid meet",
  });
  root.appendChild(terrainImg);

  // Vector label overlay in a nested <svg> that shares the same coordinate
  // space as the exported panorama CSS-pixel dimensions.
  if (data.labels.length > 0 || data.nodes.length > 0) {
    const labelSvg = el<SVGSVGElement>("svg", {
      x: slot.x,
      y: slot.y,
      width: slot.w,
      height: slot.h,
      viewBox: `0 0 ${data.cssW} ${data.cssH}`,
      preserveAspectRatio: "xMidYMid meet",
      overflow: "visible",
    });

    const LABEL_FONT = "system-ui, -apple-system, sans-serif";
    const LABEL_SIZE = 13;
    const LEADER_COLOR = theme.muted;

    // Node labels (site projections visible in the panorama window)
    for (const { node, cx, cy } of data.nodes) {
      const nodeG = el<SVGGElement>("g");
      // Leader tick from node circle upward
      nodeG.appendChild(
        line({
          x1: cx, y1: cy - 10, x2: cx, y2: cy - 24,
          stroke: LEADER_COLOR, "stroke-width": 1.5,
        }),
      );
      // Name label
      const nameTxt = text(node.name, {
        x: cx, y: cy - 28,
        "font-family": LABEL_FONT,
        "font-size": LABEL_SIZE,
        "font-weight": "600",
        fill: theme.text,
        "text-anchor": "middle",
        "dominant-baseline": "auto",
        "paint-order": "stroke",
        stroke: theme.surface,
        "stroke-width": 4,
        "stroke-linejoin": "round",
      });
      nodeG.appendChild(nameTxt);
      labelSvg.appendChild(nodeG);
    }

    // Panorama labels (peaks + POIs) rendered at 45° like the live chart
    for (const label of data.labels) {
      const lG = el<SVGGElement>("g");

      // Leader line from terrain to label anchor
      lG.appendChild(
        line({
          x1: label.x, y1: label.lineStartY,
          x2: label.anchorX, y2: label.anchorY,
          stroke: LEADER_COLOR, "stroke-width": 1,
          opacity: "0.7",
        }),
      );

      // Dot at terrain position
      lG.appendChild(
        el("circle", { cx: label.x, cy: label.y, r: 2.5, fill: LEADER_COLOR, opacity: "0.8" }),
      );

      // Label text at 45°
      const labelTxt = text(label.name, {
        x: label.anchorX,
        y: label.anchorY,
        transform: `rotate(-45, ${label.anchorX}, ${label.anchorY})`,
        "font-family": LABEL_FONT,
        "font-size": LABEL_SIZE,
        fill: theme.text,
        "paint-order": "stroke",
        stroke: theme.surface,
        "stroke-width": 3,
        "stroke-linejoin": "round",
      });
      lG.appendChild(labelTxt);

      labelSvg.appendChild(lG);
    }

    root.appendChild(labelSvg);
  }
}

// ---------------------------------------------------------------------------
// Link profile section builder
// ---------------------------------------------------------------------------

function buildLinkProfileSection(
  root: SVGSVGElement,
  slot: SlotRect,
  resolvedSvgEl: SVGSVGElement,
): void {
  // Resolve original SVG dimensions (set as attributes by the chart component).
  const origW = parseFloat(resolvedSvgEl.getAttribute("width") ?? "800");
  const origH = parseFloat(resolvedSvgEl.getAttribute("height") ?? "300");

  // Nested <svg> scales the profile to fill the slot while preserving aspect ratio.
  const wrapper = el<SVGSVGElement>("svg", {
    x: slot.x,
    y: slot.y,
    width: slot.w,
    height: slot.h,
    viewBox: `0 0 ${origW} ${origH}`,
    preserveAspectRatio: "xMidYMid meet",
    overflow: "visible",
  });

  // Move all children from the resolved clone into the wrapper.
  // We copy children rather than appendChild(resolvedSvgEl) so that the nested
  // <svg> element uses our controlled x/y/width/height attributes.
  for (const child of Array.from(resolvedSvgEl.childNodes)) {
    wrapper.appendChild(child.cloneNode(true));
  }

  root.appendChild(wrapper);
}

// ---------------------------------------------------------------------------
// Serialise SVG → data URL (for PNG rasterisation path)
// ---------------------------------------------------------------------------

export function svgToDataUrl(svgEl: SVGSVGElement): string {
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svgEl);
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
}
