import clsx from "clsx";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** "default" = accent-filled CTA. "ghost" = glass-surface toggle. "danger" = destructive action. */
  variant?: "default" | "ghost" | "danger";
  /** "default" = labeled button. "icon" = 34×34 transparent icon-only (no variant base styles). */
  size?: "default" | "icon";
  /** Applies .is-selected: accent-soft bg, accent-tinted border. */
  isSelected?: boolean;
  children: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", size = "default", isSelected = false, className, type = "button", children, ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={clsx(
        size === "icon"
          ? "btn-icon"
          : variant === "ghost"
            ? "btn-ghost"
            : "btn",
        variant === "danger" && size !== "icon" && "btn-danger",
        isSelected && "is-selected",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  ),
);

Button.displayName = "Button";
