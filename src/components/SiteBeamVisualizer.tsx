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

const sectorPath = (cx: number, cy: number, radius: number, widthDeg: number, centerDeg: number): string => {
  const start = polarToPoint(cx, cy, radius, centerDeg - widthDeg / 2);
  const end = polarToPoint(cx, cy, radius, centerDeg + widthDeg / 2);
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
  const cy = 66;
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
      <div className="beam-visualizer-charts is-two-view">
        {([
          { label: "Side view", kind: "side" as const },
          { label: "Top view", kind: "top" as const },
        ]).map((chart) => (
          <div className="beam-visualizer-chart-group" key={chart.label}>
            <span>{chart.label}</span>
            <svg className="beam-visualizer-chart" viewBox="0 0 220 132" aria-hidden="true" focusable="false">
              {chart.kind === "side" ? (
                <line className="beam-visualizer-ground" x1="10" x2="210" y1={cy} y2={cy} />
              ) : (
                <>
                  <line className="beam-visualizer-axis" x1={cx} x2={cx} y1="8" y2="124" />
                  <line className="beam-visualizer-axis" x1="52" x2="168" y1={cy} y2={cy} />
                  <text className="beam-visualizer-north" x={cx} y="12">N</text>
                </>
              )}
              {isDirectional ? (
                <>
                  {chart.kind === "top" ? (
                    <circle
                      className="beam-visualizer-residual"
                      cx={cx}
                      cy={cy}
                      r={maxRadius * (metrics.residualRangePercent / 100)}
                    />
                  ) : (
                    <ellipse
                      className="beam-visualizer-residual"
                      cx={cx}
                      cy={cy}
                      rx={maxRadius * (metrics.residualRangePercent / 100)}
                      ry={Math.max(8, maxRadius * (metrics.residualRangePercent / 180))}
                    />
                  )}
                  <g transform={chart.kind === "top" ? `rotate(${metrics.azimuthDeg} ${cx} ${cy})` : undefined}>
                    {metrics.bands.map((band) => (
                      <path
                        className={`beam-visualizer-band beam-visualizer-band-${band.state}`}
                        d={sectorPath(
                          cx,
                          cy,
                          maxRadius * (band.radiusPercent / 100),
                          chart.kind === "top" ? metrics.beamWidthDeg : metrics.verticalBeamWidthDeg,
                          chart.kind === "top" ? -90 : -metrics.tiltDeg,
                        )}
                        key={band.state}
                      />
                    ))}
                    <line
                      className="beam-visualizer-boresight"
                      x1={cx}
                      x2={chart.kind === "top" ? cx : polarToPoint(cx, cy, maxRadius, -metrics.tiltDeg).x}
                      y1={cy}
                      y2={chart.kind === "top" ? cy - maxRadius : polarToPoint(cx, cy, maxRadius, -metrics.tiltDeg).y}
                    />
                  </g>
                </>
              ) : chart.kind === "top" ? (
                metrics.bands.map((band) => (
                  <circle
                    className={`beam-visualizer-band beam-visualizer-band-${band.state}`}
                    cx={cx}
                    cy={cy}
                    key={band.state}
                    r={maxRadius * 0.55 * (band.radiusPercent / 100)}
                  />
                ))
              ) : (
                metrics.bands.map((band) => {
                  const radius = maxRadius * 0.92 * (band.radiusPercent / 100);
                  return (
                    <ellipse
                      className={`beam-visualizer-band beam-visualizer-band-${band.state}`}
                      cx={cx}
                      cy={cy}
                      key={band.state}
                      rx={radius}
                      ry={Math.max(6, radius * (metrics.verticalBeamWidthDeg / 150) * 0.55)}
                    />
                  );
                })
              )}
              {chart.kind === "top" ? (
                <circle className="beam-visualizer-baseline" cx={cx} cy={cy} r={baselineRadius * 0.45} />
              ) : (
                <ellipse className="beam-visualizer-baseline" cx={cx} cy={cy} rx={baselineRadius * 0.75} ry={baselineRadius * 0.34} />
              )}
              <circle className="beam-visualizer-origin" cx={cx} cy={cy} r="5" />
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
          Off-axis gain cannot be reduced by more than {metrics.maxAttenuationDb.toFixed(0)} dB. For example, 9 dBi on-axis bottoms out at {(9 - metrics.maxAttenuationDb).toFixed(0)} dBi, so side and rear signal remains.
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
