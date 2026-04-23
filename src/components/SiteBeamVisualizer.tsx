import { useMemo } from "react";
import { computeBeamPreviewMetrics, type BeamPreviewInput } from "../lib/beamVisualizer";
import { StateDot } from "./StateDot";
import { FloatingPopover } from "./ui/FloatingPopover";
import type { RefObject } from "react";

type SiteBeamVisualizerProps = {
  values: BeamPreviewInput;
};

type SiteBeamVisualizerPopoverProps = SiteBeamVisualizerProps & {
  open: boolean;
  onClose: () => void;
  triggerRef?: RefObject<HTMLElement | null>;
};

const polarToPoint = (cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } => {
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + Math.cos(angleRad) * radius,
    y: cy + Math.sin(angleRad) * radius,
  };
};

const sectorPath = (cx: number, cy: number, radius: number, widthDeg: number): string => {
  const start = polarToPoint(cx, cy, radius, -90 - widthDeg / 2);
  const end = polarToPoint(cx, cy, radius, -90 + widthDeg / 2);
  const largeArc = widthDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
};

export function SiteBeamVisualizer({ values }: SiteBeamVisualizerProps) {
  const metrics = useMemo(() => computeBeamPreviewMetrics(values), [values]);
  const cx = 110;
  const cy = 116;
  const maxRadius = 96 * metrics.rangeScore;

  return (
    <div
      className="beam-visualizer"
      role="img"
      aria-label={`Educational beam preview: ${metrics.rangeLabel.toLowerCase()} relative range, ${metrics.beamWidthDeg} deg relative beam width.`}
    >
      <div className="beam-visualizer-header">
        <strong>Beam preview</strong>
        <span>{metrics.rangeLabel} range</span>
      </div>
      <svg className="beam-visualizer-chart" viewBox="0 0 220 132" aria-hidden="true" focusable="false">
        <line className="beam-visualizer-axis" x1={cx} x2={cx} y1="18" y2={cy} />
        {metrics.bands.map((band) => (
          <path
            className={`beam-visualizer-band beam-visualizer-band-${band.state}`}
            d={sectorPath(cx, cy, maxRadius * (band.radiusPercent / 100), metrics.beamWidthDeg)}
            key={band.state}
          />
        ))}
        <circle className="beam-visualizer-origin" cx={cx} cy={cy} r="5" />
      </svg>
      <div className="beam-visualizer-stats">
        <span>Width {metrics.beamWidthDeg} deg</span>
        <span>Budget {metrics.linkBudgetScoreDb.toFixed(1)} dB</span>
      </div>
      <ul className="beam-visualizer-legend">
        <li>
          <StateDot state="pass_clear" />
          <span>Strong core</span>
        </li>
        <li>
          <StateDot state="pass_blocked" />
          <span>Usable</span>
        </li>
        <li>
          <StateDot state="fail_clear" />
          <span>Marginal</span>
        </li>
        <li>
          <StateDot state="fail_blocked" />
          <span>Weak edge</span>
        </li>
      </ul>
      <p className="field-help beam-visualizer-note">Not to scale, illustration only.</p>
    </div>
  );
}

export function SiteBeamVisualizerPopover({ open, onClose, triggerRef, values }: SiteBeamVisualizerPopoverProps) {
  return (
    <FloatingPopover
      className="beam-visualizer-popover"
      estimatedHeight={290}
      estimatedWidth={300}
      onClose={onClose}
      open={open}
      triggerRef={triggerRef}
    >
      <SiteBeamVisualizer values={values} />
    </FloatingPopover>
  );
}
