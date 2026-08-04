import { ActionButton } from "./ActionButton";
import { InlineCloseIconButton } from "./InlineCloseIconButton";
import { ModalOverlay } from "./ModalOverlay";

type ConfirmActionModalProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmActionModal({
  title,
  message,
  confirmLabel = "Delete",
  onCancel,
  onConfirm,
}: ConfirmActionModalProps) {
  return (
    <ModalOverlay aria-label={title} onClose={onCancel} tier="raised">
      <div className="library-manager-card confirm-action-card">
        <div className="library-manager-header">
          <h2>{title}</h2>
          <InlineCloseIconButton onClick={onCancel} />
        </div>
        <p className="field-help">{message}</p>
        <div className="chip-group">
          <ActionButton onClick={onCancel} type="button">
            Cancel
          </ActionButton>
          <ActionButton onClick={onConfirm} type="button" variant="danger">
            {confirmLabel}
          </ActionButton>
        </div>
      </div>
    </ModalOverlay>
  );
}
