import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import onboardingMarkdown from "../../docs/onboarding.md?raw";
import { ModalOverlay } from "./ModalOverlay";
import SimulationLibraryPanel from "./SimulationLibraryPanel";

const FEEDBACK_ISSUES_URL = "https://github.com/wilhel1812/LinkSim/issues/new/choose";
const PRIVACY_URL = "https://github.com/wilhel1812/LinkSim/blob/main/docs/legal/PRIVACY.md";
const TERMS_URL = "https://github.com/wilhel1812/LinkSim/blob/main/docs/legal/TERMS.md";

type WelcomeModalProps = {
  open: boolean;
  onClose: () => void;
  onLoadSimulation: (presetId: string) => void;
  expandOnboarding?: boolean;
};

export default function WelcomeModal({
  open,
  onClose,
  onLoadSimulation,
  expandOnboarding = false,
}: WelcomeModalProps) {
  const [onboardingExpanded, setOnboardingExpanded] = useState(expandOnboarding);

  if (!open) return null;

  return (
    <ModalOverlay aria-label="Welcome" onClose={onClose} tier="raised">
      <div className="library-manager-card welcome-modal-card">
        <div className="library-manager-header">
          <h2>Welcome to LinkSim</h2>
          <button className="inline-action" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="welcome-modal-onboarding-section">
          <button
            className="inline-action welcome-modal-onboarding-toggle"
            onClick={() => setOnboardingExpanded((prev) => !prev)}
            type="button"
          >
            Getting Started {onboardingExpanded ? "▾" : "▸"}
          </button>
          {onboardingExpanded ? (
            <div className="tutorial-markdown welcome-modal-onboarding-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{onboardingMarkdown}</ReactMarkdown>
            </div>
          ) : null}
        </div>

        <SimulationLibraryPanel
          hideSaveCopy
          onClose={onClose}
          onLoadSimulation={onLoadSimulation}
        />

        <div className="tutorial-report-cta">
          <a className="inline-action tutorial-report-button" href={FEEDBACK_ISSUES_URL} rel="noreferrer" target="_blank">
            Report Issue or Suggestion
          </a>
          <div className="asset-list">
            <a href={PRIVACY_URL} rel="noreferrer" target="_blank">
              Privacy Notice
            </a>
            <a href={TERMS_URL} rel="noreferrer" target="_blank">
              Terms & Acceptable Use
            </a>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
