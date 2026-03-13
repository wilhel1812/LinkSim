export type UiThemeMode = "light" | "dark";
export type UiColorTheme = "blue" | "pink";

export type ThemeVariant = {
  cssVars: Record<string, string>;
  map: {
    linkColor: string;
    meshNodeColor: string;
    meshLabelColor: string;
  };
};

export type ThemeDefinition = Record<UiThemeMode, ThemeVariant>;

