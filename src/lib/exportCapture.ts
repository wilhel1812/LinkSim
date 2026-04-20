/**
 * Hybrid per-section export compositor.
 *
 * Instead of calling html-to-image on the whole ExportFrame (which fails for
 * canvas elements via SVG foreignObject), this compositor:
 *  - draws the map directly from the pre-captured mapDataUrl (cover-fit)
 *  - draws the site-marker overlay via html-to-image with canvas nodes filtered out
 *  - draws each DOM/SVG section (header, profile, results, footer) via html-to-image
 *  - draws the PanoramaChart terrain canvas directly via ctx.drawImage (pixel-perfect)
 *
 * All positions are computed from getBoundingClientRect() relative to the frame root,
 * so this works for both stacked and 16:9 side-by-side layouts.
 */

import { toBlob } from "html-to-image";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load an image from a data URL or object URL and wait for it to decode. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Composite a DOM element at its position relative to `frameRect`. */
async function drawDomEl(
  ctx: OffscreenCanvasRenderingContext2D,
  el: HTMLElement,
  frameRect: DOMRect,
  pixelRatio: number,
  filterFn?: (node: Element) => boolean,
): Promise<void> {
  const r = el.getBoundingClientRect();
  const x = r.left - frameRect.left;
  const y = r.top - frameRect.top;
  const blob = await toBlob(el, {
    pixelRatio,
    skipFonts: false,
    ...(filterFn ? { filter: filterFn as (node: HTMLElement) => boolean } : {}),
  });
  if (!blob) return;
  const bmp = await createImageBitmap(blob);
  ctx.drawImage(bmp, x, y, r.width, r.height);
  bmp.close();
}

/** Composite a canvas element directly (bypasses html-to-image serialisation). */
function drawCanvasEl(
  ctx: OffscreenCanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  frameRect: DOMRect,
): void {
  const r = canvas.getBoundingClientRect();
  const x = r.left - frameRect.left;
  const y = r.top - frameRect.top;
  ctx.drawImage(canvas, x, y, r.width, r.height);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture a fully-rendered ExportFrame portal element into a PNG Blob.
 *
 * @param frameEl    The portal ExportFrame root div (off-screen but with layout).
 * @param mapDataUrl PNG data URL from captureMapSnapshot(); null if map excluded.
 * @param pixelRatio Output resolution multiplier (default 2 for 2× quality).
 */
export async function captureExportFrame(
  frameEl: HTMLDivElement,
  mapDataUrl: string | null,
  pixelRatio = 2,
): Promise<Blob> {
  const W = frameEl.offsetWidth;
  const H = frameEl.offsetHeight;

  if (W === 0 || H === 0) {
    throw new Error("ExportFrame has zero dimensions — cannot capture.");
  }

  const oc = new OffscreenCanvas(Math.round(W * pixelRatio), Math.round(H * pixelRatio));
  const ctx = oc.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D context from OffscreenCanvas.");
  ctx.scale(pixelRatio, pixelRatio);

  const frameRect = frameEl.getBoundingClientRect();

  // Shortcuts
  const drawEl = (el: HTMLElement, filterFn?: (node: Element) => boolean) =>
    drawDomEl(ctx, el, frameRect, pixelRatio, filterFn);
  const drawCanvas = (canvas: HTMLCanvasElement) =>
    drawCanvasEl(ctx, canvas, frameRect);

  // 1. Header ----------------------------------------------------------------
  const headerEl = frameEl.querySelector<HTMLElement>(".export-frame-header");
  if (headerEl) await drawEl(headerEl);

  // 2. Map slot --------------------------------------------------------------
  // Draw the mapDataUrl with cover-fit, then overlay site-marker pills via
  // html-to-image (with the canvas node filtered out so background is transparent).
  const mapSlotEl = frameEl.querySelector<HTMLElement>(".export-frame-map-slot");
  if (mapSlotEl) {
    const r = mapSlotEl.getBoundingClientRect();
    const x = r.left - frameRect.left;
    const y = r.top - frameRect.top;

    if (mapDataUrl) {
      const img = await loadImage(mapDataUrl);
      // Cover-fit the source image into the slot rectangle
      const scale = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, r.width, r.height);
      ctx.clip();
      ctx.drawImage(img, x + (r.width - dw) / 2, y + (r.height - dh) / 2, dw, dh);
      ctx.restore();
    }

    // Overlay site-marker pills (canvas nodes excluded → transparent background)
    await drawEl(
      mapSlotEl,
      (node) => !(node instanceof HTMLCanvasElement),
    );
  }

  // 3. Profile slot ----------------------------------------------------------
  // For LinkProfileChart (SVG): drawEl captures everything correctly.
  // For PanoramaChart (canvas): drawEl captures labels/wrappers but canvas is
  // blank in foreignObject. Fix by compositing the terrain canvas directly on top.
  const profileSlotEl = frameEl.querySelector<HTMLElement>(".export-frame-profile-slot");
  if (profileSlotEl) {
    // Draw label + DOM wrapper (canvas inside renders black — we fix next)
    await drawEl(profileSlotEl);

    // If a PanoramaChart terrain canvas is present, overwrite with direct pixels
    const terrainCanvas = profileSlotEl.querySelector<HTMLCanvasElement>(
      ".panorama-terrain-canvas",
    );
    if (terrainCanvas) {
      drawCanvas(terrainCanvas);
    }
  }

  // 4. Results slot ----------------------------------------------------------
  const resultsSlotEl = frameEl.querySelector<HTMLElement>(".export-frame-results-slot");
  if (resultsSlotEl) await drawEl(resultsSlotEl);

  // 5. Footer ----------------------------------------------------------------
  const footerEl = frameEl.querySelector<HTMLElement>(".export-frame-footer");
  if (footerEl) await drawEl(footerEl);

  return oc.convertToBlob({ type: "image/png" });
}
