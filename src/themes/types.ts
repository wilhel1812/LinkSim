export type UiThemeMode = "light" | "dark";
export type UiColorTheme = "blue" | "pink" | "red" | "green" | "yellow";

export type HolidayThemeKey = "easter";

export type HolidayTheme = {
  key: HolidayThemeKey;
  title: string;
  message: string;
  colorTheme: UiColorTheme;
  windowId: string;
};

export type ThemeVariant = {
  cssVars: Record<string, string>;
  map: {
    linkColor: string;
    selectedLinkColor: string;
    profileLineColor: string;
    meshNodeColor: string;
    meshLabelColor: string;
    meshStrokeColor: string;
    meshHaloColor: string;
  };
};

export type ThemeDefinition = Record<UiThemeMode, ThemeVariant>;

export type ThemeSemanticTokens = {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  selection: string;
  temporary: string;
  stagingFrame: string;
  localFrame: string;
  cursorOutline: string;
  focusOutline?: string;
};

export type ThemeVisualizationTokens = {
  terrain: string;
  los: string;
  fresnel: string;
  meshHalo: string;
  meshStroke: string;
};

export type ThemeCompatibilityTokens = Record<
  | "--accent-soft"
  | "--warning-soft"
  | "--warning-text"
  | "--selection-soft"
  | "--temporary-soft"
  | "--temporary-ring"
  | "--overlay-backdrop"
  | "--shadow"
  | "--progress-track-bg"
  | "--progress-gradient-start"
  | "--progress-gradient-end"
  | "--shadow-elev-1"
  | "--shadow-elev-2"
  | "--shadow-elev-3"
  | "--shadow-elev-4"
  | "--shadow-elev-5",
  string
>;
