import { CircleX } from "lucide-react";
import { Button } from "./ui/Button";

type InlineCloseIconButtonProps = {
  disabled?: boolean;
  onClick: () => void;
};

export function InlineCloseIconButton({ disabled = false, onClick }: InlineCloseIconButtonProps) {
  return (
    <Button aria-label="Close" disabled={disabled} size="icon" onClick={onClick} title="Close">
      <CircleX aria-hidden="true" strokeWidth={1.8} />
    </Button>
  );
}
