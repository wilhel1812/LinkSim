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
