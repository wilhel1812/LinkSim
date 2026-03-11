import { useEffect, useState } from "react";

export type SystemTheme = "light" | "dark";

const query = "(prefers-color-scheme: dark)";

const getTheme = (): SystemTheme =>
  window.matchMedia(query).matches ? "dark" : "light";

export const useSystemTheme = (): SystemTheme => {
  const [theme, setTheme] = useState<SystemTheme>(() => getTheme());

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setTheme(media.matches ? "dark" : "light");

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return theme;
};
