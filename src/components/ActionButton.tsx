import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "./ui/Button";

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "default" | "danger";
};

export function ActionButton({ variant = "default", ...props }: ActionButtonProps) {
  return <Button variant={variant} {...props} />;
}
