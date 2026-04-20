import { forwardRef, useEffect, useRef, type CSSProperties } from "react";
import { LinkProfileChart } from "./LinkProfileChart";
import { PanoramaChart } from "./PanoramaChart";
import type { PanoramaConfig } from "./PanoramaChart";
import { SimulationResultsSection } from "./SimulationResultsSection";
import type { SnapshotDimensions, SiteProjection } from "../lib/snapshotCompositor";

// Re-export for consumers that imported SiteProjection from here
export type { SiteProjection };

export type ExportFrameProps = {
  /** PNG data URL of the GL map canvas — painted into a 2D <canvas> element. */
  mapDataUrl: string | null;
  dimensions: SnapshotDimensions;
  includeMap: boolean;
  includeProfile: boolean;
  includeResults: boolean;
  includeFooter: boolean;
  footerUrl: string | null;
  simulationName: string;
  /** Section label, e.g. "SiteA → SiteB" or "Panorama — SiteA". */
  profileLabel: string;
  /** True when panorama is the active chart (1 site selected). False = path profile. */
  isSingleSiteSelection: boolean;
  /** Normalised [0,1] site positions from MapView.getSiteProjections(). */
  siteProjections: SiteProjection[];
  /** When provided, seeds the export's PanoramaChart with the main app's current settings. */
  panoramaConfig?: PanoramaConfig;
};

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const PRESET_SIZES: Record<SnapshotDimensions, { w: number; h: number | null }> = {
  "auto":  { w: 1200, h: null },
  "16:9":  { w: 1920, h: 1080 },
  "1:1":   { w: 1200, h: 1200 },
  "9:16":  { w: 1080, h: 1920 },
};

const HEADER_PX        = 52;
const FOOTER_PX        = 44;
const PROFILE_FRACTION = 0.28;  // min profile height as fraction of total frame
const RESULTS_FRACTION = 0.14;
const PROFILE_AUTO_PX  = 300;
const RESULTS_AUTO_PX  = 260;
const LEFT_COL_FRACTION = 0.62; // 16:9 side-by-side left column width

// ---------------------------------------------------------------------------
// SiteMarkers — uses app .site-pin CSS class for consistent styling
// ---------------------------------------------------------------------------

function SiteMarkers({ projections }: { projections: SiteProjection[] }) {
  if (projections.length === 0) return null;
  return (
    <>
      {projections.map(({ id, name, normX, normY }) => {
        if (normX < -0.05 || normX > 1.05 || normY < -0.05 || normY > 1.05) return null;
        return (
          <div
            key={id}
            style={{
              position: "absolute",
              left: `${normX * 100}%`,
              top: `${normY * 100}%`,
              // Anchor bottom-centre of pill to the site coordinate
              transform: "translate(-50%, calc(-100% - 4px))",
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            {/* Reuse the app's site-pin CSS class for identical look */}
            <div className="site-pin" style={{ cursor: "default", whiteSpace: "nowrap" }}>
              {name}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Chart slot
// ---------------------------------------------------------------------------

function ChartSlot({
  isSingleSiteSelection,
  profileLabel,
  panoramaConfig,
}: {
  isSingleSiteSelection: boolean;
  profileLabel: string;
  panoramaConfig?: PanoramaConfig;
}) {
  return (
    <>
      <p className="export-frame-slot-label">{profileLabel}</p>
      {isSingleSiteSelection ? (
        <PanoramaChart
          isExpanded={false}
          onToggleExpanded={() => {}}
          showExpandToggle={false}
          panelClassName="export-chart-panel"
          initialPanoramaConfig={panoramaConfig}
        />
      ) : (
        <LinkProfileChart
          isExpanded={false}
          onToggleExpanded={() => {}}
          showExpandToggle={false}
          panelClassName="export-chart-panel"
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// ExportFrame
// ---------------------------------------------------------------------------

export const ExportFrame = forwardRef<HTMLDivElement, ExportFrameProps>(function ExportFrame(
  {
    mapDataUrl,
    dimensions,
    includeMap,
    includeProfile,
    includeResults,
    includeFooter,
    footerUrl,
    simulationName,
    profileLabel,
    isSingleSiteSelection,
    siteProjections,
    panoramaConfig,
  },
  ref,
) {
  const preset  = PRESET_SIZES[dimensions];
  const W       = preset.w;
  const isFixed = preset.h !== null;

  const showMap     = includeMap;
  const showProfile = includeProfile;
  const showResults = includeResults;
  const showFooter  = includeFooter && Boolean(footerUrl);

  // 16:9 with results → side-by-side: map+profile on left, results on right
  const sideBySide = dimensions === "16:9" && showResults;
  const leftColW   = sideBySide ? Math.round(W * LEFT_COL_FRACTION) : W;

  // ---------------------------------------------------------------------------
  // Layout heights
  // ---------------------------------------------------------------------------

  const profileH   = isFixed ? Math.round(preset.h! * PROFILE_FRACTION) : PROFILE_AUTO_PX;
  const resultsH   = isFixed ? Math.round(preset.h! * RESULTS_FRACTION) : RESULTS_AUTO_PX;
  const autoMapH   = Math.round(W * 9 / 16); // 675px for 1200-wide auto preset

  // Available height between header and footer
  const bodyH = isFixed ? preset.h! - HEADER_PX - (showFooter ? FOOTER_PX : 0) : 0;

  // Map canvas pixel dimensions
  const mapCanvasW = leftColW;
  const mapCanvasH = isFixed
    ? sideBySide
      ? bodyH - (showProfile ? profileH : 0)
      : bodyH - (showProfile ? profileH : 0) - (showResults ? resultsH : 0)
    : autoMapH;

  // ---------------------------------------------------------------------------
  // Map canvas painting
  // ---------------------------------------------------------------------------

  const mapCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = mapCanvasRef.current;
    if (!canvas || !mapDataUrl) return;
    const cW = Math.max(1, mapCanvasW);
    const cH = Math.max(1, mapCanvasH);
    const img = new Image();
    img.onload = () => {
      canvas.width  = cW;
      canvas.height = cH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // cover-fit
      const scale = Math.max(cW / img.naturalWidth, cH / img.naturalHeight);
      const dw = img.naturalWidth  * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, (cW - dw) / 2, (cH - dh) / 2, dw, dh);
    };
    img.src = mapDataUrl;
  }, [mapDataUrl, mapCanvasW, mapCanvasH]);

  // ---------------------------------------------------------------------------
  // Root style — only dimensions; CSS vars inherited from app :root
  // ---------------------------------------------------------------------------

  const rootStyle: CSSProperties = {
    width: W,
    ...(isFixed ? { height: preset.h! } : {}),
  };

  // ---------------------------------------------------------------------------
  // Map slot JSX (reused in both layouts)
  // ---------------------------------------------------------------------------

  const mapSlot = showMap ? (
    <div
      className="export-frame-map-slot"
      style={
        isFixed
          ? { flex: 1, minHeight: 0, overflow: "hidden" }
          : { height: autoMapH, flexShrink: 0 }
      }
    >
      <canvas
        ref={mapCanvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
      <SiteMarkers projections={siteProjections} />
    </div>
  ) : null;

  // ---------------------------------------------------------------------------
  // Profile slot JSX
  // ---------------------------------------------------------------------------

  const profileSlot = showProfile ? (
    <div
      className="export-frame-profile-slot"
      style={
        sideBySide
          // In side-by-side left column: fixed height
          ? { height: profileH, flexShrink: 0 }
          // Stacked: min-height, but grow to fill all space when map is hidden
          : showMap
            ? { minHeight: profileH, flexShrink: 0 }
            : { flex: 1, minHeight: profileH }
      }
    >
      <ChartSlot isSingleSiteSelection={isSingleSiteSelection} profileLabel={profileLabel} panoramaConfig={panoramaConfig} />
    </div>
  ) : null;

  // ---------------------------------------------------------------------------
  // Results slot JSX
  // ---------------------------------------------------------------------------

  const resultsSlot = showResults ? (
    <div
      className="export-frame-results-slot"
      style={
        sideBySide
          // In side-by-side right column: flex fills the column
          ? { flex: 1, minHeight: 0 }
          : { height: resultsH, flexShrink: 0 }
      }
    >
      <p className="export-frame-slot-label">Link Analysis</p>
      <div className="export-results-inner">
        <SimulationResultsSection />
      </div>
    </div>
  ) : null;

  // ---------------------------------------------------------------------------
  // Header + Footer
  // ---------------------------------------------------------------------------

  const header = (
    <div className="export-frame-header" style={{ height: HEADER_PX, flexShrink: 0 }}>
      <span className="export-frame-sim-name">{simulationName}</span>
    </div>
  );

  const footer = showFooter && footerUrl ? (
    <div className="export-frame-footer" style={{ height: FOOTER_PX, flexShrink: 0 }}>
      {footerUrl}
    </div>
  ) : null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="export-frame"
      data-dims={dimensions}
      ref={ref}
      style={rootStyle}
    >
      {header}

      {sideBySide ? (
        /* 16:9 side-by-side: left col (map + profile) | right col (results) */
        <div className="export-frame-body" style={{ flex: 1, minHeight: 0 }}>
          <div className="export-frame-left-col" style={{ flex: `0 0 ${leftColW}px` }}>
            {mapSlot}
            {profileSlot}
          </div>
          <div className="export-frame-right-col" style={{ flex: 1, minWidth: 0 }}>
            {resultsSlot}
          </div>
        </div>
      ) : (
        /* Stacked layout */
        <>
          {mapSlot}
          {profileSlot}
          {resultsSlot}
        </>
      )}

      {footer}
    </div>
  );
});
