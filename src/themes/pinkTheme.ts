import type { ThemeDefinition } from "./types";

export const PINK_THEME: ThemeDefinition = {
  light: {
    cssVars: {
      "--bg": "#f7eef4",
      "--surface": "#fff6fb",
      "--surface-2": "#fffaff",
      "--border": "#e2bfd4",
      "--text": "#372634",
      "--muted": "#745769",
      "--accent": "#d43f8d",
      "--accent-soft": "rgba(212, 63, 141, 0.2)",
      "--terrain": "#8d7284",
      "--fresnel": "rgba(212, 63, 141, 0.24)",
      "--los": "#b06c93",
      "--shadow": "0 16px 42px rgba(92, 42, 72, 0.16)",
    },
    map: {
      linkColor: "#ff73b4",
      meshNodeColor: "#ff73b4",
      meshLabelColor: "#ffd6e8",
    },
  },
  dark: {
    cssVars: {
      "--bg": "#100b12",
      "--surface": "#1a121d",
      "--surface-2": "#22172a",
      "--border": "#3d2a47",
      "--text": "#f3e7ef",
      "--muted": "#c3a9ba",
      "--accent": "#ff73b4",
      "--accent-soft": "rgba(255, 115, 180, 0.24)",
      "--terrain": "#b095aa",
      "--fresnel": "rgba(255, 115, 180, 0.28)",
      "--los": "#ffa5cc",
      "--shadow": "0 20px 48px rgba(0, 0, 0, 0.52)",
    },
    map: {
      linkColor: "#ff73b4",
      meshNodeColor: "#ff73b4",
      meshLabelColor: "#ffd6e8",
    },
  },
};

