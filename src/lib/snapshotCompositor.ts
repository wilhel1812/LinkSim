import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SnapshotDimensions = "auto" | "16:9" | "1:1" | "9:16";

export type SnapshotOptions = {
  includeProfile: boolean;
  includeFooter: boolean;
  theme: "light" | "dark";
  dimensions: SnapshotDimensions;
  /** URL shown in the footer. null → omit footer even if includeFooter is true. */
  footerUrl: string | null;
};

export type CompositorInput = {
  /** PNG data URL for the map, captured via MapViewHandle.captureMapSnapshot(). */
  mapSnapshotUrl: string | null;
  /** Data URL for the coverage/heatmap overlay, composited on top of the map. */
  overlayDataUrl: string | null;
  /** Profile panel content. Canvas for panorama, SVG element for path profile, null if unavailable. */
  profileContent:
    | { type: "canvas"; el: HTMLCanvasElement }
    | { type: "svg"; el: SVGSVGElement }
    | null;
  options: SnapshotOptions;
};

// ---------------------------------------------------------------------------
// Layout constants (output pixels at 2× density)
// ---------------------------------------------------------------------------

const EXPORT_WIDTH_AUTO = 2400;
const PROFILE_HEIGHT_AUTO = 560;
const FOOTER_HEIGHT = 64;

type Layout = {
  width: number;
  height: number;
  mapRect: Rect;
  profileRect: Rect | null;
  footerRect: Rect | null;
};

type Rect = { x: number; y: number; w: number; h: number };

function buildLayout(options: SnapshotOptions, hasProfile: boolean): Layout {
  const { dimensions, includeProfile, includeFooter, footerUrl } = options;

  const showProfile = includeProfile && hasProfile;
  const showFooter = includeFooter && footerUrl != null;

  let W: number;
  let mapAspect: number;

  switch (dimensions) {
    case "16:9":
      W = 3840;
      mapAspect = 16 / 9;
      break;
    case "1:1":
      W = 2400;
      mapAspect = 1;
      break;
    case "9:16":
      W = 2160;
      mapAspect = 9 / 16;
      break;
    default: // "auto"
      W = EXPORT_WIDTH_AUTO;
      mapAspect = 16 / 9;
  }

  const mapH = Math.round(W / mapAspect);
  const profileH = showProfile ? (dimensions === "auto" ? PROFILE_HEIGHT_AUTO : Math.round(W * 0.15)) : 0;
  const footerH = showFooter ? FOOTER_HEIGHT : 0;
  const H = mapH + profileH + footerH;

  return {
    width: W,
    height: H,
    mapRect: { x: 0, y: 0, w: W, h: mapH },
    profileRect: showProfile ? { x: 0, y: mapH, w: W, h: profileH } : null,
    footerRect: showFooter ? { x: 0, y: mapH + profileH, w: W, h: footerH } : null,
  };
}

// ---------------------------------------------------------------------------
// Theme colours
// ---------------------------------------------------------------------------

const THEME = {
  light: {
    background: "#ffffff",
    footerBg: "#f5f5f5",
    footerText: "#444444",
    profileBg: "#ffffff",
  },
  dark: {
    background: "#1a1a1a",
    footerBg: "#111111",
    footerText: "#cccccc",
    profileBg: "#1a1a1a",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function svgToDataUrl(el: SVGSVGElement): string {
  const clone = el.cloneNode(true) as SVGSVGElement;
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(clone);
  const encoded = encodeURIComponent(svgStr);
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

async function svgToImage(el: SVGSVGElement): Promise<HTMLImageElement> {
  return loadImage(svgToDataUrl(el));
}

// ---------------------------------------------------------------------------
// Core compositor — produces an HTMLCanvasElement
// ---------------------------------------------------------------------------

export async function composeSnapshot(input: CompositorInput): Promise<HTMLCanvasElement> {
  const { mapSnapshotUrl, overlayDataUrl, profileContent, options } = input;
  const theme = THEME[options.theme];

  const hasProfile = profileContent != null;
  const layout = buildLayout(options, hasProfile);
  const { width, height, mapRect, profileRect, footerRect } = layout;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  // Background
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  // --- Map ---
  if (mapSnapshotUrl) {
    try {
      const mapImg = await loadImage(mapSnapshotUrl);
      ctx.drawImage(mapImg, mapRect.x, mapRect.y, mapRect.w, mapRect.h);
    } catch {
      // Map image unavailable — leave background colour
    }
  }

  // --- Overlay raster (composited on top of map) ---
  if (overlayDataUrl) {
    try {
      const overlayImg = await loadImage(overlayDataUrl);
      ctx.drawImage(overlayImg, mapRect.x, mapRect.y, mapRect.w, mapRect.h);
    } catch {
      // Overlay unavailable — skip silently
    }
  }

  // --- Profile / Panorama ---
  if (profileRect && profileContent) {
    ctx.fillStyle = theme.profileBg;
    ctx.fillRect(profileRect.x, profileRect.y, profileRect.w, profileRect.h);

    if (profileContent.type === "canvas") {
      try {
        ctx.drawImage(profileContent.el, profileRect.x, profileRect.y, profileRect.w, profileRect.h);
      } catch {
        // Canvas read failure — skip
      }
    } else {
      try {
        const img = await svgToImage(profileContent.el);
        ctx.drawImage(img, profileRect.x, profileRect.y, profileRect.w, profileRect.h);
      } catch {
        // SVG render failure — skip
      }
    }
  }

  // --- Footer ---
  if (footerRect && options.footerUrl) {
    ctx.fillStyle = theme.footerBg;
    ctx.fillRect(footerRect.x, footerRect.y, footerRect.w, footerRect.h);

    ctx.fillStyle = theme.footerText;
    const fontSize = Math.round(footerRect.h * 0.38);
    ctx.font = `${fontSize}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      options.footerUrl,
      footerRect.x + footerRect.w / 2,
      footerRect.y + footerRect.h / 2,
    );
  }

  return canvas;
}

// ---------------------------------------------------------------------------
// PNG export
// ---------------------------------------------------------------------------

export async function composeToPng(input: CompositorInput): Promise<Blob> {
  const canvas = await composeSnapshot(input);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob returned null"))),
      "image/png",
    );
  });
}

// ---------------------------------------------------------------------------
// PDF export — raster map/panorama, vector path profile + text
// ---------------------------------------------------------------------------

export async function composeToPdf(input: CompositorInput): Promise<Blob> {
  const { mapSnapshotUrl, overlayDataUrl, profileContent, options } = input;
  const theme = THEME[options.theme];

  const hasProfile = profileContent != null;
  const layout = buildLayout(options, hasProfile);
  const { width, height, mapRect, profileRect, footerRect } = layout;

  const doc = new jsPDF({
    orientation: width >= height ? "landscape" : "portrait",
    unit: "px",
    format: [width, height],
    compress: true,
  });

  // Background
  doc.setFillColor(theme.background);
  doc.rect(0, 0, width, height, "F");

  // --- Map (raster) ---
  if (mapSnapshotUrl) {
    if (overlayDataUrl) {
      // Composite map + overlay into a temporary canvas, then embed
      try {
        const mapImg = await loadImage(mapSnapshotUrl);
        const overlayImg = await loadImage(overlayDataUrl);
        const tmpCanvas = document.createElement("canvas");
        tmpCanvas.width = mapRect.w;
        tmpCanvas.height = mapRect.h;
        const tmpCtx = tmpCanvas.getContext("2d")!;
        tmpCtx.drawImage(mapImg, 0, 0, mapRect.w, mapRect.h);
        tmpCtx.drawImage(overlayImg, 0, 0, mapRect.w, mapRect.h);
        doc.addImage(tmpCanvas.toDataURL("image/jpeg", 0.92), "JPEG", mapRect.x, mapRect.y, mapRect.w, mapRect.h);
      } catch {
        doc.addImage(mapSnapshotUrl, "PNG", mapRect.x, mapRect.y, mapRect.w, mapRect.h);
      }
    } else {
      doc.addImage(mapSnapshotUrl, "PNG", mapRect.x, mapRect.y, mapRect.w, mapRect.h);
    }
  }

  // --- Profile panel ---
  if (profileRect && profileContent) {
    doc.setFillColor(theme.profileBg);
    doc.rect(profileRect.x, profileRect.y, profileRect.w, profileRect.h, "F");

    if (profileContent.type === "canvas") {
      // Panorama: raster (accepted by user)
      try {
        const dataUrl = profileContent.el.toDataURL("image/jpeg", 0.9);
        doc.addImage(dataUrl, "JPEG", profileRect.x, profileRect.y, profileRect.w, profileRect.h);
      } catch {
        // Skip on failure
      }
    } else {
      // Path profile: embed as vector SVG using svg2pdf.js
      try {
        const clone = profileContent.el.cloneNode(true) as SVGSVGElement;
        clone.style.position = "absolute";
        clone.style.visibility = "hidden";
        clone.setAttribute("width", String(profileRect.w));
        clone.setAttribute("height", String(profileRect.h));
        document.body.appendChild(clone);
        await svg2pdf(clone, doc, {
          x: profileRect.x,
          y: profileRect.y,
          width: profileRect.w,
          height: profileRect.h,
        });
        document.body.removeChild(clone);
      } catch {
        // Fallback: rasterise SVG and embed
        try {
          const img = await svgToImage(profileContent.el);
          const tmpC = document.createElement("canvas");
          tmpC.width = profileRect.w;
          tmpC.height = profileRect.h;
          tmpC.getContext("2d")!.drawImage(img, 0, 0, profileRect.w, profileRect.h);
          doc.addImage(tmpC.toDataURL("image/png"), "PNG", profileRect.x, profileRect.y, profileRect.w, profileRect.h);
        } catch {
          // Give up
        }
      }
    }
  }

  // --- Footer (vector text) ---
  if (footerRect && options.footerUrl) {
    doc.setFillColor(theme.footerBg);
    doc.rect(footerRect.x, footerRect.y, footerRect.w, footerRect.h, "F");

    const [r, g, b] = hexToRgb(theme.footerText);
    doc.setTextColor(r, g, b);
    const fontSize = Math.round(footerRect.h * 0.38);
    doc.setFontSize(fontSize);
    doc.text(
      options.footerUrl,
      footerRect.x + footerRect.w / 2,
      footerRect.y + footerRect.h / 2,
      { align: "center", baseline: "middle" },
    );
  }

  return doc.output("blob");
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];
  return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
}
