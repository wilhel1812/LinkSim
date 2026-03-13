export type UiThemeMode = "light" | "dark";
export type UiColorTheme = "blue" | "pink";

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
