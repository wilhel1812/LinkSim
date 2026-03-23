import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import onboardingMarkdown from "../../docs/onboarding.md?raw";
import { ModalOverlay } from "./ModalOverlay";

type OnboardingTutorialModalProps = {
  open: boolean;
  onClose: () => void;
};

const FEEDBACK_ISSUES_URL = "https://github.com/wilhel1812/LinkSim/issues/new/choose";
const PRIVACY_URL = "https://github.com/wilhel1812/LinkSim/blob/main/docs/legal/PRIVACY.md";
const TERMS_URL = "https://github.com/wilhel1812/LinkSim/blob/main/docs/legal/TERMS.md";

export default function OnboardingTutorialModal({ open, onClose }: OnboardingTutorialModalProps) {
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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{onboardingMarkdown}</ReactMarkdown>
        </div>
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
