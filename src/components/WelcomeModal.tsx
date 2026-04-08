import { ModalOverlay } from "./ModalOverlay";
import { ActionButton } from "./ActionButton";

type WelcomeModalProps = {
  open: boolean;
  onClose: () => void;
  onOpenOnboarding: () => void;
  onOpenLibrary: () => void;
  onCreateNewSimulation: () => void;
};

export default function WelcomeModal({
  open,
  onClose,
  onOpenOnboarding,
  onOpenLibrary,
  onCreateNewSimulation,
}: WelcomeModalProps) {
  if (!open) return null;

  return (
    <ModalOverlay aria-label="Welcome" onClose={onClose} tier="raised">
      <div className="welcome-compact-card">
        <h2>Welcome to LinkSim</h2>
        <p>
          LinkSim helps you plan and visualize radio links between sites. Get started by opening
          an existing simulation, creating a new one, or reading the getting started guide.
        </p>
        <div className="welcome-compact-actions">
          <ActionButton onClick={onOpenLibrary} type="button">
            Open Simulation Library
          </ActionButton>
          <ActionButton onClick={onCreateNewSimulation} type="button">
            Create New Simulation
          </ActionButton>
          <ActionButton onClick={onOpenOnboarding} type="button">
            Read Getting Started
          </ActionButton>
        </div>
      </div>
    </ModalOverlay>
  );
}
