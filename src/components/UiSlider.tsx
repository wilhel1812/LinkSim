import type { CSSProperties } from "react";

type UiSliderProps = {
  ariaLabel: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  orientation?: "horizontal" | "vertical";
  step?: number;
  value: number;
};

export function UiSlider({ ariaLabel, max, min, onChange, orientation = "horizontal", step = 1, value }: UiSliderProps) {
  const style = { "--ui-slider-fill": `${((value - min) / Math.max(0.0001, max - min)) * 100}%` } as CSSProperties;
  return (
    <label className={`ui-slider ui-slider-${orientation}`}>
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
    </label>
  );
}
