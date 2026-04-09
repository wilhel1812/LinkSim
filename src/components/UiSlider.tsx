import type { CSSProperties } from "react";

type UiSliderProps = {
  ariaLabel: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  orientation?: "horizontal" | "vertical";
  step?: number;
  value: number;
  valueLabel: string;
};

export function UiSlider({
  ariaLabel,
  label,
  max,
  min,
  onChange,
  orientation = "horizontal",
  step = 1,
  value,
  valueLabel,
}: UiSliderProps) {
  const style = orientation === "vertical" ? ({ "--ui-slider-fill": `${((value - min) / Math.max(0.0001, max - min)) * 100}%` } as CSSProperties) : undefined;
  return (
    <label className={`ui-slider ui-slider-${orientation}`}>
      <span className="ui-slider-label">{label}</span>
      <input
        aria-label={ariaLabel}
        className="ui-slider-input"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={step}
        style={style}
        type="range"
        value={value}
      />
      <span className="ui-slider-value">{valueLabel}</span>
    </label>
  );
}

