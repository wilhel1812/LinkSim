import type { Dispatch, SetStateAction } from "react";

type MobileWorkspacePanel = "navigator" | "inspector" | "profile";
type MobileBottomPanelMode = "normal" | "hidden" | "full";

type MobileWorkspaceTabsProps = {
  activePanel: MobileWorkspacePanel;
  mode: MobileBottomPanelMode;
  navigatorPanelId: string;
  navigatorTabId: string;
  inspectorPanelId: string;
  inspectorTabId: string;
  profilePanelId: string;
  profileTabId: string;
  setIsMapExpanded: Dispatch<SetStateAction<boolean>>;
  setMobileActivePanel: Dispatch<SetStateAction<MobileWorkspacePanel>>;
  setMobileBottomPanelVisibility: (mode: MobileBottomPanelMode) => void;
};

export const isActiveMobilePanelTab = (
  mode: MobileBottomPanelMode,
  activePanel: MobileWorkspacePanel,
  panel: MobileWorkspacePanel,
) => mode !== "hidden" && activePanel === panel;

export function MobileWorkspaceTabs({
  activePanel,
  mode,
  navigatorPanelId,
  navigatorTabId,
  inspectorPanelId,
  inspectorTabId,
  profilePanelId,
  profileTabId,
  setIsMapExpanded,
  setMobileActivePanel,
  setMobileBottomPanelVisibility,
}: MobileWorkspaceTabsProps) {
  const selectPanel = (panel: MobileWorkspacePanel) => {
    setIsMapExpanded(false);
    setMobileActivePanel(panel);
    if (mode === "hidden") {
      setMobileBottomPanelVisibility("normal");
    }
  };

  return (
    <div className="mobile-workspace-tabs" role="tablist" aria-label="Mobile workspace panels">
      <button
        aria-controls={navigatorPanelId}
        aria-selected={isActiveMobilePanelTab(mode, activePanel, "navigator")}
        className={`mobile-workspace-tab ${isActiveMobilePanelTab(mode, activePanel, "navigator") ? "is-active" : ""}`}
        id={navigatorTabId}
        onClick={() => selectPanel("navigator")}
        role="tab"
        type="button"
      >
        Navigator
      </button>
      <button
        aria-controls={inspectorPanelId}
        aria-selected={isActiveMobilePanelTab(mode, activePanel, "inspector")}
        className={`mobile-workspace-tab ${isActiveMobilePanelTab(mode, activePanel, "inspector") ? "is-active" : ""}`}
        id={inspectorTabId}
        onClick={() => selectPanel("inspector")}
        role="tab"
        type="button"
      >
        Inspector
      </button>
      <button
        aria-controls={profilePanelId}
        aria-selected={isActiveMobilePanelTab(mode, activePanel, "profile")}
        className={`mobile-workspace-tab ${isActiveMobilePanelTab(mode, activePanel, "profile") ? "is-active" : ""}`}
        id={profileTabId}
        onClick={() => selectPanel("profile")}
        role="tab"
        type="button"
      >
        Profile
      </button>
    </div>
  );
}
