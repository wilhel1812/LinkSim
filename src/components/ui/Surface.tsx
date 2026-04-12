import clsx from "clsx";
import { forwardRef } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type SurfaceVariant = "pill" | "card";

type SurfaceProps = {
  variant?: SurfaceVariant;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
} & HTMLAttributes<HTMLDivElement>;

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(
  ({ variant = "card", className, children, style, ...rest }, ref) => (
    <div
      ref={ref}
      className={clsx("ui-surface-pill", variant === "card" && "is-card", className)}
      style={style}
      {...rest}
    >
      {children}
    </div>
  ),
);

Surface.displayName = "Surface";
