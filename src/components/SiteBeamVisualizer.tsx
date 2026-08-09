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
  const heltecBaselineMetrics = useMemo(
    () =>
      computeBeamPreviewMetrics({
        antennaHeightM: 2,
        txPowerDbm: 22,
        txGainDbi: 2,
        rxGainDbi: 2,
        cableLossDb: 1,
      }),
    [],
  );
  const cx = 110;
  const cy = 116;
  const maxRadius = 96 * metrics.rangeScore;
  const baselineRadius = 96 * heltecBaselineMetrics.rangeScore;
  const isDirectional = values.antennaMode === "directional";

  return (
    <div
      className="beam-visualizer"
      role="img"
      aria-label={`Educational ${isDirectional ? "directional" : "omnidirectional"} beam preview: ${metrics.rangeLabel.toLowerCase()} relative range with stronger and weaker illustrated beam areas.`}
    >
      <div className="beam-visualizer-header">
        <strong>Beam preview</strong>
        <span>{metrics.rangeLabel} range</span>
      </div>
      <div className={`beam-visualizer-charts ${isDirectional ? "is-directional" : ""}`}>
        {(isDirectional
          ? [
              { label: "Horizontal", widthDeg: metrics.beamWidthDeg },
              { label: "Vertical", widthDeg: metrics.verticalBeamWidthDeg },
            ]
          : [{ label: "All directions", widthDeg: 360 }]
        ).map((chart) => (
          <div className="beam-visualizer-chart-group" key={chart.label}>
            <span>{chart.label}</span>
            <svg className="beam-visualizer-chart" viewBox="0 0 220 132" aria-hidden="true" focusable="false">
              {isDirectional ? <line className="beam-visualizer-axis" x1={cx} x2={cx} y1="18" y2={cy} /> : null}
              {metrics.bands.map((band) => isDirectional ? (
                <path
                  className={`beam-visualizer-band beam-visualizer-band-${band.state}`}
                  d={sectorPath(cx, cy, maxRadius * (band.radiusPercent / 100), chart.widthDeg)}
                  key={band.state}
                />
              ) : (
                <circle
                  className={`beam-visualizer-band beam-visualizer-band-${band.state}`}
                  cx={cx}
                  cy={66}
                  key={band.state}
                  r={maxRadius * 0.55 * (band.radiusPercent / 100)}
                />
              ))}
              {isDirectional ? (
                <circle className="beam-visualizer-baseline" cx={cx} cy={cy} r={baselineRadius * 0.45} />
              ) : null}
              <circle className="beam-visualizer-origin" cx={cx} cy={isDirectional ? cy : 66} r="5" />
            </svg>
          </div>
        ))}
      </div>
      <ul className="beam-visualizer-legend">
        <li>
          <StateDot state="pass_clear" />
          <span>Pass</span>
        </li>
        <li>
          <StateDot state="fail_blocked" />
          <span>Fail</span>
        </li>
      </ul>
      <p className="field-help beam-visualizer-baseline-note">Outline: Typical Heltec V3 setup</p>
      {isDirectional ? (
        <p className="field-help beam-visualizer-pattern-note">
          Horizontal {metrics.beamWidthDeg.toFixed(0)}° · Vertical {metrics.verticalBeamWidthDeg.toFixed(0)}° · Side/rear loss capped at {metrics.maxAttenuationDb.toFixed(0)} dB
        </p>
      ) : null}
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
