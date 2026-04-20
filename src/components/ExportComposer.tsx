import { Download, Printer, RefreshCw, Share2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { captureExportFrame } from "../lib/exportCapture";
import { ActionButton } from "./ActionButton";
import { ExportFrame } from "./ExportFrame";
import { useUiTheme } from "../hooks/useUiTheme";
import type { UiColorTheme } from "../themes/types";
import type { SnapshotDimensions } from "../lib/snapshotCompositor";
import type { MapViewHandle } from "./MapView";
import type { PanoramaChartHandle, PanoramaConfig } from "./PanoramaChart";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportComposerProps = {
  mapViewHandle: MapViewHandle | null;
  /** PanoramaChart handle from the main app — used to seed the export instance config. */
  panoramaHandle: PanoramaChartHandle | null;
  /** True when there is selectable profile content (1+ sites or a link selected). */
  profileAvailable: boolean;
  /** True when the panorama is the active bottom panel (1 site selected). */
  isSingleSiteSelection: boolean;
  /** True when a link is selected and results can be shown. */
  isLinkSelected: boolean;
  /** Deep-link URL for public sims; https://linksim.link for private; null when none. */
  shareUrl: string | null;
  simulationName: string;
  /** Computed section label, e.g. "SiteA → SiteB" or "Panorama — SiteA". */
  profileLabel: string;
};

const DIMENSION_LABELS: Record<SnapshotDimensions, string> = {
  auto:   "Auto-fit",
  "16:9": "16 : 9",
  "1:1":  "1 : 1",
  "9:16": "9 : 16 (vertical)",
};

const FRAME_WIDTHS: Record<SnapshotDimensions, number> = {
  "auto":  1200,
  "16:9":  1920,
  "1:1":   1200,
  "9:16":  1080,
};

// ---------------------------------------------------------------------------
// Ensure the print portal div exists in document.body
// ---------------------------------------------------------------------------

function ensurePrintPortal(): HTMLDivElement {
  let portal = document.getElementById("export-print-portal") as HTMLDivElement | null;
  if (!portal) {
    portal = document.createElement("div");
    portal.id = "export-print-portal";
    document.body.appendChild(portal);
  }
  return portal;
}

// ---------------------------------------------------------------------------
// ExportComposer
// ---------------------------------------------------------------------------

export function ExportComposer({
  mapViewHandle,
  panoramaHandle,
  profileAvailable,
  isSingleSiteSelection,
  isLinkSelected,
  shareUrl,
  simulationName,
  profileLabel,
}: ExportComposerProps) {
  // App theme — controls the whole UI (and map basemap) consistently
  const { preference, setPreference, colorTheme, setColorTheme } = useUiTheme();

  // Read panorama config from the main app's live instance on first render
  const [panoramaConfig, setPanoramaConfig] = useState<PanoramaConfig | undefined>(() =>
    panoramaHandle?.getPanoramaConfig() ?? undefined,
  );
  useEffect(() => {
    const cfg = panoramaHandle?.getPanoramaConfig();
    if (cfg) setPanoramaConfig(cfg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [mapDataUrl,     setMapDataUrl]     = useState<string | null>(null);
  const [isCapturing,    setIsCapturing]    = useState(false);
  const [includeMap,     setIncludeMap]     = useState(true);
  const [includeProfile, setIncludeProfile] = useState(true);
  const [includeResults, setIncludeResults] = useState(isLinkSelected);
  const [includeFooter,  setIncludeFooter]  = useState(true);
  const [dimensions,     setDimensions]     = useState<SnapshotDimensions>("auto");
  const [exportError,    setExportError]    = useState<string | null>(null);

  // Portal ExportFrame ref — full-size, hidden, used for PNG / print capture.
  const captureFrameRef = useRef<HTMLDivElement>(null);

  // Preview column ref — measured to compute zoom scale.
  const previewColRef   = useRef<HTMLDivElement>(null);
  const [previewColWidth, setPreviewColWidth] = useState(460);

  // Portal state — useState so a re-render happens once the div is created.
  const [printPortal, setPrintPortal] = useState<HTMLDivElement | null>(null);

  const footerUrl = shareUrl ?? "https://linksim.link";

  // Measure preview column for zoom scaling.
  useEffect(() => {
    const el = previewColRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setPreviewColWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ensure the print portal div exists.
  useEffect(() => {
    setPrintPortal(ensurePrintPortal());
  }, []);

  // ---------------------------------------------------------------------------
  // Map capture
  // ---------------------------------------------------------------------------

  const captureMap = useCallback(async () => {
    if (!mapViewHandle) return;
    setIsCapturing(true);
    setExportError(null);
    try {
      const snap = await mapViewHandle.captureMapSnapshot();
      setMapDataUrl(snap?.dataUrl ?? null);
    } catch (err) {
      console.warn("[export] map capture failed:", err);
      setExportError(err instanceof Error ? err.message : "Map capture failed.");
    } finally {
      setIsCapturing(false);
    }
  }, [mapViewHandle]);

  // Capture map once on mount.
  useEffect(() => {
    void captureMap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-capture map when the app theme changes (basemap style may have switched).
  const prevPreferenceRef = useRef(preference);
  useEffect(() => {
    if (prevPreferenceRef.current === preference) return;
    prevPreferenceRef.current = preference;
    // Give MapLibre time to load the new basemap style before capturing.
    const timer = setTimeout(() => void captureMap(), 1200);
    return () => clearTimeout(timer);
  }, [preference, captureMap]);

  // ---------------------------------------------------------------------------
  // Download / print / share
  // ---------------------------------------------------------------------------

  const handleDownloadPng = useCallback(async () => {
    if (!captureFrameRef.current) return;
    setExportError(null);
    try {
      const blob = await captureExportFrame(captureFrameRef.current, mapDataUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFilename(simulationName)}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn("[export] PNG download failed:", err);
      setExportError(err instanceof Error ? err.message : "Export failed.");
    }
  }, [simulationName, mapDataUrl]);

  const handlePrint = useCallback(() => window.print(), []);

  const handleNativeShare = useCallback(async () => {
    if (!captureFrameRef.current) return;
    setExportError(null);
    try {
      const blob = await captureExportFrame(captureFrameRef.current, mapDataUrl);
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
    }
  }, [simulationName, shareUrl, mapDataUrl]);

  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.canShare === "function";

  // ---------------------------------------------------------------------------
  // Preview zoom scale
  // ---------------------------------------------------------------------------

  const frameW       = FRAME_WIDTHS[dimensions];
  const previewScale = previewColWidth > 0 ? previewColWidth / frameW : 1;

  // ---------------------------------------------------------------------------
  // Shared ExportFrame props (no exportTheme — inherited from app :root)
  // ---------------------------------------------------------------------------

  const frameProps = {
    mapDataUrl:           includeMap ? mapDataUrl : null,
    dimensions,
    includeMap,
    includeProfile:       includeProfile && profileAvailable,
    includeResults:       includeResults && isLinkSelected,
    includeFooter,
    footerUrl:            includeFooter ? footerUrl : null,
    simulationName,
    profileLabel,
    isSingleSiteSelection,
    siteProjections:      mapViewHandle?.getSiteProjections() ?? [],
    panoramaConfig,
  } as const;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="export-composer">
      {/* Left column: live scaled preview */}
      <div className="export-composer-preview-col" ref={previewColRef}>
        <div className="export-preview-wrap">
          {isCapturing && (
            <div className="export-preview-spinner" aria-label="Capturing map…">
              <RefreshCw aria-hidden="true" className="export-preview-spinner-icon" size={20} strokeWidth={1.8} />
            </div>
          )}
          <div className="export-preview-scale-wrap" style={{ zoom: previewScale }}>
            <ExportFrame {...frameProps} />
          </div>
        </div>
      </div>

      {/* Right column: options + actions */}
      <div className="export-composer-controls-col">
        <div className="export-options">
          <fieldset className="export-fieldset">
            <legend className="export-legend">Include in export</legend>

            <label className="export-toggle-label">
              <input checked={includeMap} onChange={(e) => setIncludeMap(e.target.checked)} type="checkbox" />
              Map
            </label>

            <label className={`export-toggle-label${!profileAvailable ? " is-disabled" : ""}`}>
              <input
                checked={includeProfile && profileAvailable}
                disabled={!profileAvailable}
                onChange={(e) => setIncludeProfile(e.target.checked)}
                type="checkbox"
              />
              {isSingleSiteSelection ? "Panorama" : "Path profile"}
              {!profileAvailable && <span className="field-help"> (no site or link selected)</span>}
            </label>

            <label className={`export-toggle-label${!isLinkSelected ? " is-disabled" : ""}`}>
              <input
                checked={includeResults && isLinkSelected}
                disabled={!isLinkSelected}
                onChange={(e) => setIncludeResults(e.target.checked)}
                type="checkbox"
              />
              Link analysis
              {!isLinkSelected && <span className="field-help"> (no link selected)</span>}
            </label>

            <label className="export-toggle-label">
              <input checked={includeFooter} onChange={(e) => setIncludeFooter(e.target.checked)} type="checkbox" />
              URL footer
            </label>
          </fieldset>

          {/* App theme — controls map + all UI consistently */}
          <div className="export-row">
            <label className="export-label" htmlFor="export-ui-theme">Theme</label>
            <select
              className="locale-select"
              id="export-ui-theme"
              value={preference}
              onChange={(e) => setPreference(e.target.value as "system" | "light" | "dark")}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div className="export-row">
            <label className="export-label" htmlFor="export-color-theme">Colors</label>
            <select
              className="locale-select"
              id="export-color-theme"
              value={colorTheme}
              onChange={(e) => setColorTheme(e.target.value as UiColorTheme)}
            >
              <option value="blue">Blue</option>
              <option value="pink">Pink</option>
              <option value="red">Red</option>
              <option value="green">Green</option>
            </select>
          </div>

          <div className="export-row">
            <label className="export-label" htmlFor="export-dimensions">Format</label>
            <select
              className="locale-select"
              id="export-dimensions"
              value={dimensions}
              onChange={(e) => setDimensions(e.target.value as SnapshotDimensions)}
            >
              {(Object.keys(DIMENSION_LABELS) as SnapshotDimensions[]).map((key) => (
                <option key={key} value={key}>{DIMENSION_LABELS[key]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="export-actions">
          <button
            aria-label="Refresh map capture"
            className="inline-action inline-action-icon"
            disabled={isCapturing}
            onClick={() => void captureMap()}
            title="Refresh map capture"
            type="button"
          >
            <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} className={isCapturing ? "spin" : ""} />
          </button>

          <ActionButton
            disabled={isCapturing}
            onClick={() => void handleDownloadPng()}
            style={{ display: "flex", alignItems: "center", gap: "0.4em" }}
            type="button"
          >
            <Download aria-hidden="true" size={14} strokeWidth={1.8} />
            PNG
          </ActionButton>

          <ActionButton
            disabled={isCapturing}
            onClick={handlePrint}
            style={{ display: "flex", alignItems: "center", gap: "0.4em" }}
            type="button"
          >
            <Printer aria-hidden="true" size={14} strokeWidth={1.8} />
            Print
          </ActionButton>

          {canNativeShare && (
            <ActionButton
              disabled={isCapturing}
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

      {/* Full-size ExportFrame in body portal — for PNG capture + @media print */}
      {printPortal && createPortal(
        <ExportFrame ref={captureFrameRef} {...frameProps} />,
        printPortal,
      )}
    </div>
  );
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, "_").trim() || "linksim-export";
}
