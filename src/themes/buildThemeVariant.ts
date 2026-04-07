import type { ThemeCompatibilityTokens, ThemeSemanticTokens, ThemeVariant, ThemeVisualizationTokens } from "./types";

const DEFAULT_DANGER_ON = "#ffffff";
const DEFAULT_FOCUS_OUTLINE = "color-mix(in srgb, var(--accent) 62%, white 18%)";

type BuildThemeVariantInput = {
  semantic: ThemeSemanticTokens;
  visualization: ThemeVisualizationTokens;
  compat: ThemeCompatibilityTokens;
  map: ThemeVariant["map"];
};

export const buildThemeVariant = ({ semantic, visualization, compat, map }: BuildThemeVariantInput): ThemeVariant => {
  return {
    cssVars: {
      "--bg": semantic.bg,
      "--surface": semantic.surface,
      "--surface-2": semantic.surface2,
      "--border": semantic.border,
      "--text": semantic.text,
      "--muted": semantic.muted,
      "--accent": semantic.accent,
      "--terrain": visualization.terrain,
      "--fresnel": visualization.fresnel,
      "--los": visualization.los,
      "--staging-frame": semantic.stagingFrame,
      "--local-frame": semantic.localFrame,
      "--warning": semantic.warning,
      "--selection": semantic.selection,
      "--temporary": semantic.temporary,
      "--cursor-outline": semantic.cursorOutline,
      "--danger": semantic.danger,
      "--danger-on": DEFAULT_DANGER_ON,
      "--success": semantic.success,
      "--mesh-halo": visualization.meshHalo,
      "--mesh-stroke": visualization.meshStroke,
      "--focus-outline": semantic.focusOutline ?? DEFAULT_FOCUS_OUTLINE,
      ...compat,
    },
    map,
  };
};
