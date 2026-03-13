import { useMemo } from "react";
import { getThemeVariant } from "../themes";
import { useUiTheme } from "./useUiTheme";

export const useThemeVariant = () => {
  const ui = useUiTheme();
  const variant = useMemo(() => getThemeVariant(ui.colorTheme, ui.theme), [ui.colorTheme, ui.theme]);
  return { ...ui, variant };
};

