import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "./Button";

type MapControlButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** "icon" = 34×34 transparent icon-only (default). "labeled" = ghost-style with border. */
  variant?: "icon" | "labeled";
  /** Applies .is-selected: accent-soft bg, accent-tinted border. */
  isSelected?: boolean;
  children: ReactNode;
};

export const MapControlButton = forwardRef<HTMLButtonElement, MapControlButtonProps>(
  ({ variant = "icon", isSelected, ...rest }, ref) => (
    <Button
      ref={ref}
      size={variant === "icon" ? "icon" : "default"}
      variant={variant === "labeled" ? "ghost" : "default"}
      isSelected={isSelected}
      {...rest}
    />
  ),
);

MapControlButton.displayName = "MapControlButton";
