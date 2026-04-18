import { Download, Share2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionButton } from "./ActionButton";
import {
  composePreview,
  composeToPdf,
  composeToPng,
  type CompositorInput,
  type SnapshotDimensions,
  type SnapshotOptions,
} from "../lib/snapshotCompositor";
import type { MapViewHandle } from "./MapView";
import type { PanoramaChartHandle } from "./PanoramaChart";
import type { LinkProfileChartHandle } from "./LinkProfileChart";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportComposerProps = {
  mapViewHandle: MapViewHandle | null;
  panoramaHandle: PanoramaChartHandle | null;
  profileHandle: LinkProfileChartHandle | null;
  /** True when there is selectable profile content to export (1+ sites or a link selected). */
  profileAvailable: boolean;
  /** True when the panorama is the active bottom panel (1 site selected). False = path profile. */
  isSingleSiteSelection: boolean;
  /** Deep-link URL for public sims; https://linksim.link for private; null when no active simulation. */
  shareUrl: string | null;
  simulationName: string;
};

const PREVIEW_WIDTH = 480;

const DIMENSION_LABELS: Record<SnapshotDimensions, string> = {
  auto: "Auto-fit",
  "16:9": "16 : 9",
  "1:1": "1 : 1",
  "9:16": "9 : 16 (vertical)",
};

// ---------------------------------------------------------------------------
// ExportComposer
// ---------------------------------------------------------------------------

export function ExportComposer({
  mapViewHandle,
  panoramaHandle,
  profileHandle,
  profileAvailable,
  isSingleSiteSelection,
  shareUrl,
  simulationName,
}: ExportComposerProps) {
  const [includeProfile, setIncludeProfile] = useState(true);
  const [includeFooter, setIncludeFooter] = useState(true);
  const [exportTheme, setExportTheme] = useState<"light" | "dark">("light");
  const [dimensions, setDimensions] = useState<SnapshotDimensions>("auto");
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [pdfFallbackWarning, setPdfFallbackWarning] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const footerUrl = shareUrl ?? "https://linksim.link";

  // ---------------------------------------------------------------------------
  // Collect compositor input
  // ---------------------------------------------------------------------------

  const buildInput = useCallback(async (): Promise<CompositorInput | null> => {
    if (!mapViewHandle) return null;

    const mapSnapshot = await mapViewHandle.captureMapSnapshot();
    const siteProjections = mapViewHandle.getSiteProjections();

    let profileContent: CompositorInput["profileContent"] = null;
    if (profileAvailable) {
      if (isSingleSiteSelection) {
        const data = panoramaHandle?.getExportData() ?? null;
        if (data) profileContent = { type: "panorama", data };
      } else {
        const svgEl = profileHandle?.getResolvedSvgElement() ?? null;
        if (svgEl) profileContent = { type: "linkprofile", svgEl };
      }
    }

    const options: SnapshotOptions = {
      includeProfile: includeProfile && profileAvailable,
      includeFooter,
      exportTheme,
      dimensions,
      footerUrl: includeFooter ? footerUrl : null,
      simulationName,
    };

    return { mapSnapshot, siteProjections, profileContent, options };
  }, [
    mapViewHandle,
    panoramaHandle,
    profileHandle,
    profileAvailable,
    isSingleSiteSelection,
    includeProfile,
    includeFooter,
    exportTheme,
    dimensions,
    footerUrl,
    simulationName,
  ]);

  // ---------------------------------------------------------------------------
  // Live preview
  // ---------------------------------------------------------------------------

  const renderPreview = useCallback(async () => {
    const input = await buildInput();
    if (!input || !previewCanvasRef.current) return;

    setPreviewing(true);
    try {
      const previewCanvas = await composePreview(input, PREVIEW_WIDTH);
      const dest = previewCanvasRef.current;
      if (!dest) return;
      dest.width = previewCanvas.width;
      dest.height = previewCanvas.height;
      dest.getContext("2d")?.drawImage(previewCanvas, 0, 0);
    } catch {
      // Silently skip failed preview renders
    } finally {
      setPreviewing(false);
    }
  }, [buildInput]);

  useEffect(() => {
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = setTimeout(() => {
      void renderPreview();
    }, 300);
    return () => {
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    };
  }, [renderPreview]);

  // ---------------------------------------------------------------------------
  // Download handlers
  // ---------------------------------------------------------------------------

  const handleDownloadPng = useCallback(async () => {
    setExportError(null);
    setExporting(true);
    try {
      const input = await buildInput();
      if (!input) throw new Error("Map not ready.");
      const blob = await composeToPng(input);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFilename(simulationName)}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }, [buildInput, simulationName]);

  const handleDownloadPdf = useCallback(async () => {
    setExportError(null);
    setPdfFallbackWarning(false);
    setExporting(true);
    try {
      const input = await buildInput();
      if (!input) throw new Error("Map not ready.");
      const { blob, usedFallback } = await composeToPdf(input);
      if (usedFallback) setPdfFallbackWarning(true);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFilename(simulationName)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "PDF export failed.");
    } finally {
      setExporting(false);
    }
  }, [buildInput, simulationName]);

  const handleNativeShare = useCallback(async () => {
    setExportError(null);
    setExporting(true);
    try {
      const input = await buildInput();
      if (!input) throw new Error("Map not ready.");
      const blob = await composeToPng(input);
      const file = new File([blob], `${sanitizeFilename(simulationName)}.png`, { type: "image/png" });
      const shareData: ShareData = {
        files: [file],
        title: simulationName,
        ...(shareUrl ? { url: shareUrl } : {}),
      };
      if (!navigator.canShare?.(shareData)) throw new Error("Native sharing not supported.");
      await navigator.share(shareData);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setExportError(err instanceof Error ? err.message : "Share failed.");
    } finally {
      setExporting(false);
    }
  }, [buildInput, simulationName, shareUrl]);

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.canShare === "function";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="export-composer">
      {/* Live preview */}
      <div className="export-preview-wrap" aria-label="Export preview" aria-live="polite">
        <canvas
          aria-hidden="true"
          className={`export-preview-canvas${previewing ? " is-loading" : ""}`}
          ref={previewCanvasRef}
          style={{ width: "100%", maxWidth: PREVIEW_WIDTH, display: "block" }}
        />
        {previewing && (
          <p className="export-preview-status field-help">Rendering preview…</p>
        )}
        {!mapViewHandle && !previewing && (
          <p className="export-preview-status field-help">Map not available yet.</p>
        )}
      </div>

      {/* Options */}
      <div className="export-options">
        {/* Panel toggles */}
        <fieldset className="export-fieldset">
          <legend className="export-legend">Include in export</legend>
          <label className={`export-toggle-label${!profileAvailable ? " is-disabled" : ""}`}>
            <input
              checked={includeProfile && profileAvailable}
              disabled={!profileAvailable}
              onChange={(e) => setIncludeProfile(e.target.checked)}
              type="checkbox"
            />
            {isSingleSiteSelection ? "Panorama" : "Path profile"}
            {!profileAvailable && (
              <span className="field-help"> (no path selected)</span>
            )}
          </label>
          <label className="export-toggle-label">
            <input
              checked={includeFooter}
              onChange={(e) => setIncludeFooter(e.target.checked)}
              type="checkbox"
            />
            URL footer
          </label>
        </fieldset>

        {/* Theme */}
        <div className="export-row">
          <span className="export-label">Theme</span>
          <div className="chip-group">
            <button
              aria-pressed={exportTheme === "light"}
              className={`inline-action${exportTheme === "light" ? " is-active" : ""}`}
              onClick={() => setExportTheme("light")}
              type="button"
            >
              Light
            </button>
            <button
              aria-pressed={exportTheme === "dark"}
              className={`inline-action${exportTheme === "dark" ? " is-active" : ""}`}
              onClick={() => setExportTheme("dark")}
              type="button"
            >
              Dark
            </button>
          </div>
        </div>

        {/* Dimensions */}
        <div className="export-row">
          <label className="export-label" htmlFor="export-dimensions">
            Format
          </label>
          <select
            className="locale-select"
            id="export-dimensions"
            onChange={(e) => setDimensions(e.target.value as SnapshotDimensions)}
            value={dimensions}
          >
            {(Object.keys(DIMENSION_LABELS) as SnapshotDimensions[]).map((key) => (
              <option key={key} value={key}>
                {DIMENSION_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Actions */}
      <div className="export-actions">
        <ActionButton
          disabled={exporting}
          onClick={() => void handleDownloadPng()}
          style={{ display: "flex", alignItems: "center", gap: "0.4em" }}
          type="button"
        >
          <Download aria-hidden="true" size={14} strokeWidth={1.8} />
          PNG
        </ActionButton>
        <ActionButton
          disabled={exporting}
          onClick={() => void handleDownloadPdf()}
          style={{ display: "flex", alignItems: "center", gap: "0.4em" }}
          type="button"
        >
          <Download aria-hidden="true" size={14} strokeWidth={1.8} />
          PDF
        </ActionButton>
        {canNativeShare && (
          <ActionButton
            disabled={exporting}
            onClick={() => void handleNativeShare()}
            style={{ display: "flex", alignItems: "center", gap: "0.4em" }}
            type="button"
          >
            <Share2 aria-hidden="true" size={14} strokeWidth={1.8} />
            Share
          </ActionButton>
        )}
      </div>

      {pdfFallbackWarning && !exportError && (
        <p className="field-help" role="status" style={{ color: "var(--warning-text)" }}>
          Vector PDF could not be generated; a raster PDF was exported instead.
        </p>
      )}

      {exportError && (
        <p className="field-help" role="alert" style={{ color: "var(--danger)" }}>
          {exportError}
        </p>
      )}
    </div>
  );
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, "_").trim() || "linksim-export";
}
