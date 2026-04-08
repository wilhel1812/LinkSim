import type { ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "default" | "danger";
};

export function ActionButton({
  children,
  className,
  type = "button",
  variant = "default",
  ...buttonProps
}: ActionButtonProps) {
  return (
    <button
      {...buttonProps}
      className={clsx("inline-action", "action-button", variant === "danger" && "danger", className)}
      type={type}
    >
      {children}
    </button>
  );
}
