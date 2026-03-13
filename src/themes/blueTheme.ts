import type { ThemeDefinition } from "./types";

export const BLUE_THEME: ThemeDefinition = {
  light: {
    cssVars: {
      "--bg": "#eef2f6",
      "--surface": "#f8fafc",
      "--surface-2": "#ffffff",
      "--border": "#d4deeb",
      "--text": "#0d1b2a",
      "--muted": "#4e5d70",
      "--accent": "#0077ff",
      "--accent-soft": "rgba(0, 119, 255, 0.14)",
      "--terrain": "#65768b",
      "--fresnel": "rgba(0, 119, 255, 0.2)",
      "--los": "#20c997",
      "--shadow": "0 16px 42px rgba(33, 49, 65, 0.14)",
    },
    map: {
      linkColor: "#00c2ff",
      meshNodeColor: "#2bc0ff",
      meshLabelColor: "#e7f1ff",
    },
  },
  dark: {
    cssVars: {
      "--bg": "#0b1018",
      "--surface": "#121b26",
      "--surface-2": "#172332",
      "--border": "#223244",
      "--text": "#e4ebf3",
      "--muted": "#96a8bd",
      "--accent": "#3da0ff",
      "--accent-soft": "rgba(61, 160, 255, 0.2)",
      "--terrain": "#8fa2ba",
      "--fresnel": "rgba(61, 160, 255, 0.22)",
      "--los": "#2fdb9f",
      "--shadow": "0 20px 48px rgba(0, 0, 0, 0.44)",
    },
    map: {
      linkColor: "#00c2ff",
      meshNodeColor: "#2bc0ff",
      meshLabelColor: "#e7f1ff",
    },
  },
};

