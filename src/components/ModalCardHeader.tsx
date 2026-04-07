import type { ReactNode } from "react";
import { CircleX } from "lucide-react";

type ModalCardHeaderProps = {
  title: string;
  onClose: () => void;
  actions?: ReactNode;
  actionsWrapperClassName?: string;
};

export function ModalCardHeader({ title, onClose, actions, actionsWrapperClassName }: ModalCardHeaderProps) {
  const closeButton = (
    <button
      aria-label="Close"
      className="inline-action inline-action-icon"
      onClick={onClose}
      title="Close"
      type="button"
    >
      <CircleX aria-hidden="true" strokeWidth={1.8} />
    </button>
  );

  return (
    <div className="library-manager-header">
      <h2>{title}</h2>
      {actionsWrapperClassName ? (
        <div className={actionsWrapperClassName}>
          {actions}
          {closeButton}
        </div>
      ) : (
        <>
          {actions}
          {closeButton}
        </>
      )}
    </div>
  );
}
