import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "./ui/Button";

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "default" | "danger";
  size?: "default" | "icon";
};

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(({ variant = "default", ...props }, ref) => (
  <Button ref={ref} variant={variant} {...props} />
));

ActionButton.displayName = "ActionButton";
