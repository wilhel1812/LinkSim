import { CircleX } from "lucide-react";
import { Button } from "./ui/Button";

type InlineCloseIconButtonProps = {
  onClick: () => void;
};

export function InlineCloseIconButton({ onClick }: InlineCloseIconButtonProps) {
  return (
    <Button aria-label="Close" size="icon" onClick={onClick} title="Close">
      <CircleX aria-hidden="true" strokeWidth={1.8} />
    </Button>
  );
}
