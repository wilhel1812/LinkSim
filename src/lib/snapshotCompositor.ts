import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";
import { buildExportLayout, type SnapshotDimensions } from "./exportLayout";
import { resolveExportTheme } from "./exportTheme";
import { buildExportSvg, svgToDataUrl, type ExportDocumentInput } from "./exportDocument";
import type { PanoramaExportData } from "../components/PanoramaChart";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { SnapshotDimensions };

export type SnapshotOptions = {
  includeProfile: boolean;
  includeFooter: boolean;
  exportTheme: "light" | "dark";
  dimensions: SnapshotDimensions;
  /** URL shown in the footer. null → omit footer even if includeFooter is true. */
  footerUrl: string | null;
  simulationName: string;
};

export type CompositorInput = {
  /** Result of MapViewHandle.captureMapSnapshot(). Already includes the overlay. */
  mapSnapshot: { dataUrl: string; naturalW: number; naturalH: number } | null;
  /** Normalised [0,1] site positions from MapViewHandle.getSiteProjections(). */
  siteProjections: Array<{ id: string; name: string; normX: number; normY: number }>;
  profileContent:
    | { type: "panorama"; data: PanoramaExportData }
    | { type: "linkprofile"; svgEl: SVGSVGElement }
    | null;
  options: SnapshotOptions;
};

// ---------------------------------------------------------------------------
// Orchestrator — composeSnapshot
// ---------------------------------------------------------------------------

/**
 * Builds the export SVG document from the collected input data and returns it.
 * The returned element is detached from the DOM.
 */
export function composeExportSvg(input: CompositorInput): SVGSVGElement {
  const { mapSnapshot, siteProjections, profileContent, options } = input;
  const { exportTheme, dimensions, includeProfile, includeFooter, footerUrl } = options;

  const theme = resolveExportTheme(exportTheme);

  const hasProfile = includeProfile && profileContent != null;
  const hasFooter = includeFooter && footerUrl != null;

  const layout = buildExportLayout({ preset: dimensions, hasProfile, hasFooter });

  const docInput: ExportDocumentInput = {
    mapSnapshot,
    siteProjections,
    profileContent: hasProfile ? profileContent : null,
    footerUrl: hasFooter ? footerUrl : null,
  };

  return buildExportSvg(docInput, layout, theme);
}

// ---------------------------------------------------------------------------
// Helper — load an SVG element into a canvas for PNG rasterisation
// ---------------------------------------------------------------------------

async function svgToCanvas(svgEl: SVGSVGElement): Promise<HTMLCanvasElement> {
  const w = parseInt(svgEl.getAttribute("width") ?? "800", 10);
  const h = parseInt(svgEl.getAttribute("height") ?? "600", 10);

  const dataUrl = svgToDataUrl(svgEl);

  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Could not get 2D context")); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error("SVG rasterisation failed"));
    img.src = dataUrl;
  });
}

// ---------------------------------------------------------------------------
// PNG export
// ---------------------------------------------------------------------------

export async function composeToPng(input: CompositorInput): Promise<Blob> {
  const svgEl = composeExportSvg(input);
  const canvas = await svgToCanvas(svgEl);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
      "image/png",
    );
  });
}

// ---------------------------------------------------------------------------
// PDF export — primary: svg2pdf.js (vector); fallback: raster JPEG
// ---------------------------------------------------------------------------

export async function composeToPdf(input: CompositorInput): Promise<{ blob: Blob; usedFallback: boolean }> {
  const svgEl = composeExportSvg(input);
  const w = parseInt(svgEl.getAttribute("width") ?? "2400", 10);
  const h = parseInt(svgEl.getAttribute("height") ?? "1350", 10);

  const doc = new jsPDF({
    orientation: w >= h ? "landscape" : "portrait",
    unit: "px",
    format: [w, h],
    compress: true,
  });

  // Attach to DOM so svg2pdf can access computed styles on nested elements.
  svgEl.style.position = "absolute";
  svgEl.style.left = "-99999px";
  svgEl.style.top = "-99999px";
  svgEl.style.visibility = "hidden";
  document.body.appendChild(svgEl);

  try {
    await svg2pdf(svgEl, doc, { x: 0, y: 0, width: w, height: h });
    document.body.removeChild(svgEl);
    return { blob: doc.output("blob"), usedFallback: false };
  } catch (primaryErr) {
    // Fallback: rasterise the SVG and embed as a single JPEG image.
    console.warn("[export] svg2pdf failed, falling back to raster PDF:", primaryErr);
    document.body.removeChild(svgEl);

    const canvas = await svgToCanvas(composeExportSvg(input));
    const fallbackDoc = new jsPDF({
      orientation: w >= h ? "landscape" : "portrait",
      unit: "px",
      format: [w, h],
      compress: true,
    });
    fallbackDoc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, w, h);
    return { blob: fallbackDoc.output("blob"), usedFallback: true };
  }
}

// ---------------------------------------------------------------------------
// Preview — renders the export SVG to a small canvas for the live preview
// ---------------------------------------------------------------------------

export async function composePreview(
  input: CompositorInput,
  previewWidth: number,
): Promise<HTMLCanvasElement> {
  const svgEl = composeExportSvg(input);
  const svgW = parseInt(svgEl.getAttribute("width") ?? "2400", 10);
  const svgH = parseInt(svgEl.getAttribute("height") ?? "1350", 10);

  const aspect = svgH / svgW;
  const outW = previewWidth;
  const outH = Math.round(previewWidth * aspect);

  // Scale the SVG down to preview size before rasterising (faster than scaling on canvas).
  svgEl.setAttribute("width", String(outW));
  svgEl.setAttribute("height", String(outH));

  const canvas = await svgToCanvas(svgEl);

  // Restore original dimensions (not strictly necessary for detached element but defensive).
  svgEl.setAttribute("width", String(svgW));
  svgEl.setAttribute("height", String(svgH));

  return canvas;
}
