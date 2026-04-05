import { useState } from "react";

const ONBOARDING_SEEN_KEY_PREFIX = "linksim:onboarding-seen:v1:";

type UseOnboardingFlowParams = {
  activeUserId: string;
  setShowSimulationLibraryRequest: (show: boolean) => void;
  setShowNewSimulationRequest: (show: boolean) => void;
};

export function useOnboardingFlow({
  activeUserId,
  setShowSimulationLibraryRequest,
  setShowNewSimulationRequest,
}: UseOnboardingFlowParams) {
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [showOnboardingTutorial, setShowOnboardingTutorial] = useState(false);

  const markSeen = () => {
    if (!activeUserId) return;
    try {
      localStorage.setItem(`${ONBOARDING_SEEN_KEY_PREFIX}${activeUserId}`, "1");
    } catch {
      // ignore storage errors
    }
  };

  const closeWelcome = () => {
    setShowWelcomeModal(false);
    markSeen();
  };

  const openOnboardingTutorial = () => {
    setShowOnboardingTutorial(true);
  };

  const openWelcomeFromWelcome = () => {
    setShowWelcomeModal(false);
    setShowOnboardingTutorial(true);
  };

  const openLibraryFromWelcome = () => {
    setShowWelcomeModal(false);
    setShowSimulationLibraryRequest(true);
    markSeen();
  };

  const createNewFromWelcome = () => {
    setShowWelcomeModal(false);
    setShowNewSimulationRequest(true);
    markSeen();
  };

  return {
    showWelcomeModal,
    setShowWelcomeModal,
    showOnboardingTutorial,
    setShowOnboardingTutorial,
    closeWelcome,
    openOnboardingTutorial,
    openWelcomeFromWelcome,
    openLibraryFromWelcome,
    createNewFromWelcome,
  };
}
