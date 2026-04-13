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
  return (
    <label className={`ui-slider ui-slider-${orientation}`}>
      <input
        aria-label={ariaLabel}
        className="ui-slider-input"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}
