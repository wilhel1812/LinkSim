import { CircleX } from "lucide-react";

type InlineCloseIconButtonProps = {
  onClick: () => void;
};

export function InlineCloseIconButton({ onClick }: InlineCloseIconButtonProps) {
  return (
    <button aria-label="Close" className="inline-action inline-action-icon" onClick={onClick} title="Close" type="button">
      <CircleX aria-hidden="true" strokeWidth={1.8} />
    </button>
  );
}
