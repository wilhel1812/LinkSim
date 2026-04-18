import { useAppStore } from "../store/appStore";
import { getThemeVariant } from "../themes";
import type { UiColorTheme } from "../themes/types";

// ---------------------------------------------------------------------------
// ExportTheme — resolved at export time from the active ThemeVariant.
// All values are concrete CSS color strings (hex or rgba), never CSS vars.
// ---------------------------------------------------------------------------

export type ExportTheme = {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  terrain: string;
  los: string;
  fresnel: string;
  success: string;
  warning: string;
  danger: string;
  /** var(--state-pass-clear) resolved value */
  statePassClear: string;
  /** var(--state-pass-blocked) resolved value */
  statePassBlocked: string;
  /** var(--state-fail-clear) resolved value = color-mix(warning 45%, danger) */
  stateFailClear: string;
  /** var(--state-fail-blocked) resolved value */
  stateFailBlocked: string;
  /** Map link-line accent color from ThemeVariant.map */
  linkColor: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/**
 * Approximate CSS color-mix(in srgb, a aFrac, b) where aFrac ∈ (0, 1).
 * Only works for hex inputs. Falls back to `a` on parse failure.
 */
function mixHex(a: string, aFrac: number, b: string): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  const bf = 1 - aFrac;
  return rgbToHex(ra[0] * aFrac + rb[0] * bf, ra[1] * aFrac + rb[1] * bf, ra[2] * aFrac + rb[2] * bf);
}

// ---------------------------------------------------------------------------
// resolveExportTheme
// ---------------------------------------------------------------------------

/**
 * Resolve a concrete ExportTheme for the given export mode ("light" | "dark").
 * Uses the user's current color theme from the app store so accent/terrain
 * colours match the rest of the interface.
 *
 * Call this at the start of an export operation (not inside a React render).
 */
export function resolveExportTheme(mode: "light" | "dark"): ExportTheme {
  const state = useAppStore.getState();
  // uiColorTheme is stored as a string; cast to UiColorTheme after a safety fallback.
  const colorTheme = ((state as Record<string, unknown>).uiColorTheme ?? "blue") as UiColorTheme;
  const variant = getThemeVariant(colorTheme, mode);
  const v = variant.cssVars;

  const success = v["--success"] ?? "#2fdb9f";
  const warning = v["--warning"] ?? "#ffb703";
  const danger = v["--danger"] ?? "#ff6b6b";

  return {
    bg: v["--bg"] ?? (mode === "dark" ? "#0b1018" : "#eef2f6"),
    surface: v["--surface-2"] ?? (mode === "dark" ? "#172332" : "#ffffff"),
    text: v["--text"] ?? (mode === "dark" ? "#e4ebf3" : "#0d1b2a"),
    muted: v["--muted"] ?? (mode === "dark" ? "#96a8bd" : "#4e5d70"),
    border: v["--border"] ?? (mode === "dark" ? "#223244" : "#d4deeb"),
    terrain: v["--terrain"] ?? (mode === "dark" ? "#8fa2ba" : "#65768b"),
    los: v["--los"] ?? (mode === "dark" ? "#2fdb9f" : "#20c997"),
    fresnel: v["--fresnel"] ?? (mode === "dark" ? "rgba(61,160,255,0.22)" : "rgba(0,119,255,0.2)"),
    success,
    warning,
    danger,
    statePassClear: success,
    statePassBlocked: warning,
    // color-mix(in srgb, var(--warning) 45%, var(--danger)) from index.css
    stateFailClear: mixHex(warning, 0.45, danger),
    stateFailBlocked: danger,
    linkColor: variant.map.linkColor,
  };
}
