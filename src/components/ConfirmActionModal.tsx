import { ActionButton } from "./ActionButton";
import { InlineCloseIconButton } from "./InlineCloseIconButton";
import { ModalOverlay } from "./ModalOverlay";

type ConfirmActionModalProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmActionModal({
  title,
  message,
  confirmLabel = "Delete",
  busy = false,
  error = "",
  onCancel,
  onConfirm,
}: ConfirmActionModalProps) {
  return (
    <ModalOverlay aria-label={title} onClose={busy ? () => undefined : onCancel} tier="raised">
      <div className="library-manager-card confirm-action-card">
        <div className="library-manager-header">
          <h2>{title}</h2>
          <InlineCloseIconButton disabled={busy} onClick={onCancel} />
        </div>
        <p className="field-help">{message}</p>
        {error ? <p className="field-help field-help-error">{error}</p> : null}
        <div className="chip-group">
          <ActionButton disabled={busy} onClick={onCancel} type="button">
            Cancel
          </ActionButton>
          <ActionButton disabled={busy} onClick={onConfirm} type="button" variant="danger">
            {busy ? "Deleting..." : confirmLabel}
          </ActionButton>
        </div>
      </div>
    </ModalOverlay>
  );
}
