import ReactMarkdown from "react-markdown";
import onboardingMarkdown from "../../docs/onboarding.md?raw";
import { ModalOverlay } from "./ModalOverlay";

type OnboardingTutorialModalProps = {
  open: boolean;
  onClose: () => void;
};

export function OnboardingTutorialModal({ open, onClose }: OnboardingTutorialModalProps) {
  if (!open) return null;
  return (
    <ModalOverlay aria-label="Onboarding Tutorial" onClose={onClose} tier="raised">
      <div className="library-manager-card tutorial-modal-card">
        <div className="library-manager-header">
          <h2>Welcome to LinkSim</h2>
          <div className="chip-group">
            <button className="inline-action" onClick={onClose} type="button">
              Close
            </button>
          </div>
        </div>
        <div className="tutorial-markdown">
          <ReactMarkdown>{onboardingMarkdown}</ReactMarkdown>
        </div>
      </div>
    </ModalOverlay>
  );
}
