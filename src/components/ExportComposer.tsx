import { Download, Share2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionButton } from "./ActionButton";
import {
  composeSnapshot,
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
  /** The current overlay data URL from the store, or null. */
  overlayDataUrl: string | null;
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
  overlayDataUrl,
  simulationName,
}: ExportComposerProps) {
  const [includeProfile, setIncludeProfile] = useState(true);
  const [includeFooter, setIncludeFooter] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [dimensions, setDimensions] = useState<SnapshotDimensions>("auto");
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The footer URL: public deeplink, or homepage for private/unsaved sims.
  const footerUrl = shareUrl ?? "https://linksim.link";

  const buildInput = useCallback(async (): Promise<CompositorInput | null> => {
    if (!mapViewHandle) return null;

    const mapSnapshotUrl = await mapViewHandle.captureMapSnapshot();

    let profileContent: CompositorInput["profileContent"] = null;
    if (profileAvailable) {
      if (isSingleSiteSelection) {
        const canvas = panoramaHandle?.getCanvas() ?? null;
        if (canvas) profileContent = { type: "canvas", el: canvas };
      } else {
        const svgEl = profileHandle?.getChartElement() ?? null;
        if (svgEl) profileContent = { type: "svg", el: svgEl };
      }
    }

    const options: SnapshotOptions = {
      includeProfile: includeProfile && profileAvailable,
      includeFooter,
      theme,
      dimensions,
      footerUrl: includeFooter ? footerUrl : null,
    };

    return { mapSnapshotUrl, overlayDataUrl, profileContent, options };
  }, [
    mapViewHandle,
    panoramaHandle,
    profileHandle,
    profileAvailable,
    isSingleSiteSelection,
    includeProfile,
    includeFooter,
    theme,
    dimensions,
    overlayDataUrl,
    footerUrl,
  ]);

  // ---------------------------------------------------------------------------
  // Live preview
  // ---------------------------------------------------------------------------

  const renderPreview = useCallback(async () => {
    const input = await buildInput();
    if (!input || !previewCanvasRef.current) return;

    setPreviewing(true);
    try {
      const composed = await composeSnapshot(input);
      const previewCanvas = previewCanvasRef.current;
      if (!previewCanvas) return;

      const aspect = composed.height / composed.width;
      previewCanvas.width = PREVIEW_WIDTH;
      previewCanvas.height = Math.round(PREVIEW_WIDTH * aspect);
      const ctx = previewCanvas.getContext("2d");
      ctx?.drawImage(composed, 0, 0, previewCanvas.width, previewCanvas.height);
    } finally {
      setPreviewing(false);
    }
  }, [buildInput]);

  // Debounce preview re-render when options change
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
    setExporting(true);
    try {
      const input = await buildInput();
      if (!input) throw new Error("Map not ready.");
      const blob = await composeToPdf(input);
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
      if (err instanceof DOMException && err.name === "AbortError") return; // user cancelled
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
              aria-pressed={theme === "light"}
              className={`inline-action${theme === "light" ? " is-active" : ""}`}
              onClick={() => setTheme("light")}
              type="button"
            >
              Light
            </button>
            <button
              aria-pressed={theme === "dark"}
              className={`inline-action${theme === "dark" ? " is-active" : ""}`}
              onClick={() => setTheme("dark")}
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
