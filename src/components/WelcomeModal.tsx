import { ModalOverlay } from "./ModalOverlay";

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
          <button
            className="inline-action welcome-compact-button"
            onClick={onOpenLibrary}
            type="button"
          >
            Open Simulation Library
          </button>
          <button
            className="inline-action welcome-compact-button"
            onClick={onCreateNewSimulation}
            type="button"
          >
            Create New Simulation
          </button>
          <button
            className="inline-action welcome-compact-button"
            onClick={onOpenOnboarding}
            type="button"
          >
            Read Getting Started
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
