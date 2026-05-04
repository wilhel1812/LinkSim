import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import { buildSettingsPath, matchSettingsPath, type SettingsSectionId } from "../../lib/deepLink";
import { useAppStore } from "../../store/appStore";
import { fetchMe, type CloudUser } from "../../lib/cloudUser";
import { getUiErrorMessage } from "../../lib/uiError";
import { ProfileSection } from "./sections/ProfileSection";
import { PreferencesSection } from "./sections/PreferencesSection";
import { SettingsNav, settingsNavIcons, type SettingsNavItem } from "./SettingsNav";
import { UserAdminPanel } from "../UserAdminPanel";

const MOBILE_BREAKPOINT_PX = 980;

type SettingsPanelProps = {
  /** Active section resolved from the URL; null → default to "profile". */
  initialSection: SettingsSectionId | null;
  onClose: () => void;
};

const useIsNarrow = () => {
  const [isNarrow, setIsNarrow] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const listener = (event: MediaQueryListEvent) => setIsNarrow(event.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);
  return isNarrow;
};

export function SettingsPanel({ initialSection, onClose }: SettingsPanelProps) {
  const currentUser = useAppStore((state) => state.currentUser);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const authState = useAppStore((state) => state.authState);
  const setAuthState = useAppStore((state) => state.setAuthState);

  const [me, setMe] = useState<CloudUser | null>(currentUser);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection ?? "profile");
  const [mobileDetailOpen, setMobileDetailOpen] = useState<boolean>(initialSection !== null);
  const isNarrow = useIsNarrow();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Load/refresh "me" when signed in.
  useEffect(() => {
    if (authState !== "signed_in") return;
    let cancelled = false;
    (async () => {
      try {
        const current = await fetchMe();
        if (cancelled) return;
        setMe(current);
        setCurrentUser(current);
      } catch (error) {
        if (cancelled) return;
        setLoadError(getUiErrorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authState, setCurrentUser]);

  // Sync active section to URL (without adding history entries).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const targetPath = buildSettingsPath(activeSection);
    if (window.location.pathname !== targetPath) {
      window.history.replaceState(null, "", `${targetPath}${window.location.search}${window.location.hash}`);
    }
  }, [activeSection]);

  // React to browser back/forward while the panel is open.
  useEffect(() => {
    const onPopState = () => {
      const match = matchSettingsPath(window.location.pathname);
      if (!match) {
        onClose();
        return;
      }
      setActiveSection(match.section ?? "profile");
      setMobileDetailOpen(match.section !== null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [onClose]);

  // Escape key closes the panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    // Focus the close button when opening for a11y.
    closeButtonRef.current?.focus();
  }, []);

  const handleMeUpdated = useCallback(
    (user: CloudUser) => {
      setMe(user);
      setCurrentUser(user);
      setAuthState("signed_in");
    },
    [setAuthState, setCurrentUser],
  );

  const handleSignOut = useCallback(() => {
    setMe(null);
    setCurrentUser(null);
    setAuthState("signed_out");
    window.location.href = "/cdn-cgi/access/logout";
  }, [setAuthState, setCurrentUser]);

  const navItems = useMemo<SettingsNavItem[]>(() => {
    const items: SettingsNavItem[] = [
      {
        id: "profile",
        label: "Profile",
        description: "Name, email, bio, avatar",
        icon: settingsNavIcons.profile,
      },
      {
        id: "preferences",
        label: "Preferences",
        description: "Theme, defaults, access request",
        icon: settingsNavIcons.preferences,
      },
    ];
    if (me?.isAdmin || me?.isModerator) {
      items.push({
        id: "admin",
        label: "Admin",
        description: "Users, audit, diagnostics",
        icon: settingsNavIcons.admin,
      });
    }
    return items;
  }, [me?.isAdmin, me?.isModerator]);

  // If user navigates to /settings/admin but loses admin rights, fall back.
  useEffect(() => {
    if (activeSection === "admin" && !(me?.isAdmin || me?.isModerator)) {
      setActiveSection("profile");
    }
  }, [activeSection, me?.isAdmin, me?.isModerator]);

  const onSelectSection = (section: SettingsSectionId) => {
    setActiveSection(section);
    setMobileDetailOpen(true);
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", buildSettingsPath(section));
    }
  };

  const onBackToList = () => {
    setMobileDetailOpen(false);
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", buildSettingsPath(null));
    }
  };

  const renderSection = () => {
    if (loadError) {
      return (
        <section className="settings-section">
          <h2>Profile unavailable</h2>
          <p className="field-help field-help-error">{loadError}</p>
        </section>
      );
    }
    switch (activeSection) {
      case "profile":
        return <ProfileSection me={me} onMeUpdated={handleMeUpdated} onSignOut={handleSignOut} />;
      case "preferences":
        return <PreferencesSection me={me} onMeUpdated={handleMeUpdated} />;
      case "admin":
        return (
          <section className="settings-section" aria-labelledby="settings-admin-heading">
            <header className="settings-section-header">
              <h2 id="settings-admin-heading">Admin</h2>
              <p className="field-help">
                User management, audit events, and diagnostics. Changes made here are audited.
              </p>
            </header>
            <div className="settings-admin-embed">
              <UserAdminPanel renderMode="admin-inline" />
            </div>
          </section>
        );
      default:
        return null;
    }
  };

  const showList = !isNarrow || !mobileDetailOpen;
  const showDetail = !isNarrow || mobileDetailOpen;

  return (
    <div
      className="settings-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-panel-title"
    >
      <header className="settings-panel-header">
        <div className="settings-panel-header-lead">
          {isNarrow && mobileDetailOpen ? (
            <button
              type="button"
              className="settings-panel-back"
              aria-label="Back to settings"
              onClick={onBackToList}
            >
              <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
              <span>Back</span>
            </button>
          ) : null}
          <h1 id="settings-panel-title" className="settings-panel-title">
            {isNarrow && mobileDetailOpen
              ? navItems.find((item) => item.id === activeSection)?.label ?? "Settings"
              : "Settings"}
          </h1>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          className="settings-panel-close"
          aria-label="Close settings"
          onClick={onClose}
        >
          <X size={20} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      <div className="settings-panel-body">
        {showList ? (
          <aside className="settings-panel-sidebar">
            <SettingsNav
              items={navItems}
              activeSection={activeSection}
              onSelect={onSelectSection}
              layout={isNarrow ? "list" : "sidebar"}
            />
          </aside>
        ) : null}
        {showDetail ? (
          <main className="settings-panel-content" tabIndex={-1}>
            {renderSection()}
          </main>
        ) : null}
      </div>
    </div>
  );
}
