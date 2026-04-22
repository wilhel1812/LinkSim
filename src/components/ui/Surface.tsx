import clsx from "clsx";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";

type SurfaceVariant = "pill" | "card";
type SurfaceTone = "default" | "muted";
type SurfacePointerTone = "accent" | "selection" | "temporary";
type SurfaceElement = "div" | "button";

type SurfaceProps = {
  as?: SurfaceElement;
  variant?: SurfaceVariant;
  tone?: SurfaceTone;
  pointerTail?: boolean;
  pointerTone?: SurfacePointerTone;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
} & HTMLAttributes<HTMLDivElement> & ButtonHTMLAttributes<HTMLButtonElement>;

export const Surface = forwardRef<HTMLElement, SurfaceProps>(
  (
    { as = "div", variant = "card", tone = "default", pointerTail = false, pointerTone = "accent", className, children, style, ...rest },
    ref,
  ) => {
    const Component = as as SurfaceElement;
    const resolvedProps =
      Component === "button"
        ? { type: (rest as ButtonHTMLAttributes<HTMLButtonElement>).type ?? "button" }
        : {};
    return (
      <Component
        ref={ref as never}
        className={clsx(
          "ui-surface-pill",
          variant === "card" && "is-card",
          as === "button" && "is-button",
          tone === "muted" && "is-muted",
          pointerTail && "has-pointer-tail",
          pointerTail && pointerTone !== "accent" && `is-pointer-${pointerTone}`,
          className,
        )}
        style={style}
        {...resolvedProps}
        {...rest}
      >
        {children}
      </Component>
    );
  },
);

Surface.displayName = "Surface";
