import { useEffect, useState, useMemo, type ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleX, Info, Layers, Maximize2, Minus, PanelRightClose, Plus, RefreshCw, X } from "lucide-react";
import { ActionButton } from "./ActionButton";
import { StateDot } from "./StateDot";
import { Surface } from "./ui/Surface";
import { Badge } from "./ui/Badge";
import { UiSlider } from "./UiSlider";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { useAppStore } from "../store/appStore";
import type { UiColorTheme } from "../themes/types";

const GALLERY_TAB_STORAGE_KEY = "linksim-ui-gallery-tab-v1";

type GalleryStatus = "standard" | "exception" | "legacy" | "under migration" | "mapped only";
type GalleryTab = "actions" | "panels" | "forms" | "notifications" | "states" | "meta-map-ui" | "theme";

const GALLERY_TABS: Array<{ id: GalleryTab; label: string }> = [
  { id: "actions", label: "Actions" },
  { id: "panels", label: "Panels" },
  { id: "forms", label: "Forms" },
  { id: "notifications", label: "Notifications" },
  { id: "states", label: "States" },
  { id: "meta-map-ui", label: "Meta/Map UI" },
  { id: "theme", label: "Theme" },
];

const SOURCE_PATHS: Record<string, string> = {
  "ActionButton": "src/components/ActionButton.tsx",
  "MapControlButton": "src/components/MapControlButton.tsx",
  "LinkButton": "src/components/LinkButton.tsx",
  "PanelShell.LeftSidePanel": "src/components/app-shell/LeftSidePanel.tsx",
  "PanelShell.RightSidePanel": "src/components/app-shell/RightSidePanel.tsx",
  "PanelShell.BottomPanel": "src/components/app-shell/BottomPanel.tsx",
  "FormActionRow": "src/components/FormActionRow.tsx",
  "Input": "src/components/ui/Input.tsx",
  "Select": "src/components/ui/Select.tsx",
  "Badge": "src/components/ui/Badge.tsx",
  "UI Slider": "src/components/UiSlider.tsx",
  "NotificationStack": "src/components/NotificationStack.tsx",
  "NotificationBanner": "src/components/NotificationBanner.tsx",
  "MapInlineNotice": "src/components/MapInlineNotice.tsx",
  "OfflineBanner": "src/components/OfflineBanner.tsx",
  "NotificationBell": "src/components/NotificationBell.tsx",
  "EmptyState": "src/components/ui/EmptyState.tsx",
  "LoadingState": "src/components/ui/LoadingState.tsx",
  "ErrorHelperStates": "src/components/ErrorHelperStates.tsx",
  "MapControls": "src/components/MapControls.tsx",
  "SidebarFooter": "src/components/SidebarFooter.tsx",
  "Surface.Pill": "src/components/ui/Surface.tsx",
  "Surface.Card": "src/components/ui/Surface.tsx",
  "StateDot": "src/components/StateDot.tsx",
};

const THEME_TOKENS = {
  semanticPrimary: [
    { token: "bg", label: "bg" },
    { token: "surface", label: "surface" },
    { token: "surface-2", label: "surface2" },
    { token: "border", label: "border" },
    { token: "text", label: "text" },
    { token: "muted", label: "muted" },
    { token: "accent", label: "accent" },
    { token: "success", label: "success" },
    { token: "warning", label: "warning" },
    { token: "danger", label: "danger" },
  ],
  semanticSecondary: [
    { token: "selection", label: "selection" },
    { token: "temporary", label: "temporary" },
    { token: "staging-frame", label: "staging-frame" },
    { token: "local-frame", label: "local-frame" },
    { token: "cursor-outline", label: "cursor-outline" },
    { token: "focus-outline", label: "focus-outline" },
  ],
  visualization: [
    { token: "terrain", label: "terrain" },
    { token: "fresnel", label: "fresnel" },
    { token: "los", label: "los" },
    { token: "mesh-halo", label: "mesh-halo" },
    { token: "mesh-stroke", label: "mesh-stroke" },
    { token: "progress-gradient-start", label: "progress-start" },
    { token: "progress-gradient-end", label: "progress-end" },
  ],
  compatibility: [
    { token: "accent-soft", label: "accent-soft" },
    { token: "warning-soft", label: "warning-soft" },
    { token: "warning-text", label: "warning-text" },
    { token: "selection-soft", label: "selection-soft" },
    { token: "temporary-soft", label: "temporary-soft" },
    { token: "temporary-ring", label: "temporary-ring" },
    { token: "overlay-backdrop", label: "overlay-backdrop" },
    { token: "shadow", label: "shadow" },
    { token: "shadow-elev-1", label: "shadow-elev-1" },
    { token: "shadow-elev-2", label: "shadow-elev-2" },
    { token: "shadow-elev-3", label: "shadow-elev-3" },
    { token: "shadow-elev-4", label: "shadow-elev-4" },
    { token: "shadow-elev-5", label: "shadow-elev-5" },
  ],
} as const;

const getCssVarKey = (token: string): string => {
  if (token === "surface-2") return "--surface-2";
  if (token === "surface-2") return "--surface-2";
  if (token === "staging-frame") return "--staging-frame";
  if (token === "local-frame") return "--local-frame";
  if (token === "cursor-outline") return "--cursor-outline";
  if (token === "focus-outline") return "--focus-outline";
  if (token === "mesh-halo") return "--mesh-halo";
  if (token === "mesh-stroke") return "--mesh-stroke";
  if (token === "progress-gradient-start") return "--progress-gradient-start";
  if (token === "progress-gradient-end") return "--progress-gradient-end";
  if (token === "accent-soft") return "--accent-soft";
  if (token === "warning-soft") return "--warning-soft";
  if (token === "warning-text") return "--warning-text";
  if (token === "selection-soft") return "--selection-soft";
  if (token === "temporary-soft") return "--temporary-soft";
  if (token === "temporary-ring") return "--temporary-ring";
  if (token === "overlay-backdrop") return "--overlay-backdrop";
  if (token.startsWith("shadow-elev-")) return `--${token}`;
  return `--${token}`;
};

const VariantList = ({ variants }: { variants: readonly string[] }) => (
  <div className="ui-pattern-variants">
    {variants.map((v) => (
      <code key={v}>{v}</code>
    ))}
  </div>
);

const StateToken = ({ varKey }: { varKey: string }) => {
  const [value, setValue] = useState<string>("—");
  useEffect(() => {
    const computed = getComputedStyle(document.documentElement);
    const val = computed.getPropertyValue(varKey).trim();
    setValue(val || "—");
  }, [varKey]);
  return (
    <>
      <div
        className="ui-theme-swatch"
        style={{ backgroundColor: value.startsWith("var(") ? undefined : value }}
      />
      <code className="ui-theme-value">{value}</code>
    </>
  );
};

const statusClassName = (status: GalleryStatus) => status.replace(/\s+/g, "-");

const StatusPill = ({ status }: { status: GalleryStatus }) => (
  <span className={`ui-pattern-status is-${statusClassName(status)}`}>{status}</span>
);

const SourcePath = ({ path }: { path: string }) => (
  <span className="ui-pattern-source">{path}</span>
);

const PatternCard = ({
  name,
  status,
  children,
}: {
  name: string;
  status: GalleryStatus;
  children: ReactNode;
}) => {
  const source = SOURCE_PATHS[name];
  return (
    <article className="ui-pattern-card">
      <header className="ui-pattern-card-header">
        <div className="ui-pattern-card-title">
          <strong>{name}</strong>
          {source ? <SourcePath path={source} /> : null}
        </div>
        <StatusPill status={status} />
      </header>
      <div className="ui-pattern-card-body">{children}</div>
    </article>
  );
};

export function UiGalleryPage() {
  const { theme, variant, colorTheme, activeHolidayTheme } = useThemeVariant();
  const [activeTab, setActiveTab] = useState<GalleryTab>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(GALLERY_TAB_STORAGE_KEY);
      if (stored && GALLERY_TABS.some((t) => t.id === stored)) {
        return stored as GalleryTab;
      }
    }
    return "actions";
  });
  const uiThemePreference = useAppStore((state) => state.uiThemePreference);
  const setUiColorTheme = useAppStore((state) => state.setUiColorTheme);
  const setUiThemePreference = useAppStore((state) => state.setUiThemePreference);
  const colorThemes: UiColorTheme[] = ["blue", "pink", "red", "green", "yellow"];

  const activeTabLabel = useMemo(
    () => GALLERY_TABS.find((t) => t.id === activeTab)?.label ?? "Gallery",
    [activeTab]
  );

  useEffect(() => {
    localStorage.setItem(GALLERY_TAB_STORAGE_KEY, activeTab);
    document.title = `LinkSim UI Gallery — ${activeTabLabel}`;
  }, [activeTab, activeTabLabel]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
    for (const [key, value] of Object.entries(variant.cssVars)) {
      root.style.setProperty(key, value);
    }
    root.style.colorScheme = theme;
  }, [theme, variant]);

  return (
    <main className="ui-gallery-page">
      <header className="ui-gallery-topbar panel-section">
        <div className="section-heading">
          <h2>LinkSim UI Gallery</h2>
          <StatusPill status="under migration" />
        </div>
        <p className="field-help">Live UI inventory grounded in real app classes/components. Route: /ui-gallery</p>
        <div className="chip-group ui-gallery-theme-toggle">
          <ActionButton aria-pressed={uiThemePreference === "system"} onClick={() => setUiThemePreference("system")} type="button">
            System
          </ActionButton>
          <ActionButton aria-pressed={uiThemePreference === "light"} onClick={() => setUiThemePreference("light")} type="button">
            Light
          </ActionButton>
          <ActionButton aria-pressed={uiThemePreference === "dark"} onClick={() => setUiThemePreference("dark")} type="button">
            Dark
          </ActionButton>
        </div>
        <div className="chip-group ui-gallery-theme-toggle">
          {colorThemes.map((entry) => (
            <ActionButton
              aria-pressed={colorTheme === entry}
              key={entry}
              onClick={() => setUiColorTheme(entry)}
              type="button"
            >
              {entry[0].toUpperCase()}
              {entry.slice(1)}
            </ActionButton>
          ))}
          {activeHolidayTheme ? (
            <span className="access-badge" title="Holiday palette is active and may override your selected color theme">
              Holiday: {activeHolidayTheme.title}
            </span>
          ) : null}
        </div>
        <nav className="ui-gallery-tabs" aria-label="UI gallery tabs">
          {GALLERY_TABS.map((tab) => (
            <ActionButton
              aria-pressed={activeTab === tab.id}
              className="ui-gallery-tab-btn"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </ActionButton>
          ))}
        </nav>
      </header>

      {activeTab === "actions" ? (
        <section className="ui-gallery-section">
          <h3>Actions</h3>
          <div className="ui-pattern-grid">
            <PatternCard name="ActionButton" status="under migration">
              <div className="chip-group">
                <ActionButton>Save Selected Path</ActionButton>
                <ActionButton>Details</ActionButton>
                <ActionButton variant="danger">Remove From Simulation</ActionButton>
              </div>
              <VariantList variants={["default", "variant=\"danger\""]} />
            </PatternCard>
            <PatternCard name="MapControlButton" status="standard">
              <div className="chip-group">
                <button aria-label="Zoom out" className="map-control-btn map-control-btn-icon" title="Zoom out" type="button">
                  <Minus aria-hidden="true" size={16} strokeWidth={1.8} />
                </button>
                <button aria-label="Zoom in" className="map-control-btn map-control-btn-icon" title="Zoom in" type="button">
                  <Plus aria-hidden="true" size={16} strokeWidth={1.8} />
                </button>
                <button aria-label="Fit bounds" className="map-control-btn map-control-btn-icon" title="Fit bounds" type="button">
                  <Maximize2 aria-hidden="true" size={16} strokeWidth={1.8} />
                </button>
              </div>
            </PatternCard>
            <PatternCard name="LinkButton" status="exception">
              <button className="inline-link-button" type="button">
                Open change log
              </button>
            </PatternCard>
          </div>
        </section>
      ) : null}

      {activeTab === "panels" ? (
        <section className="ui-gallery-section">
          <h3>Panels</h3>
          <div className="ui-pattern-grid ui-pattern-grid-shells">
            <PatternCard name="PanelShell.LeftSidePanel" status="under migration">
              <aside className="sidebar-panel">
                <header>
                  <div className="section-heading">
                    <h2>Simulation</h2>
                    <span className="field-help">left shell</span>
                  </div>
                </header>
                <section className="panel-section">
                  <div className="section-heading">
                    <h2>Sites</h2>
                    <span className="field-help">header rhythm</span>
                  </div>
                  <div className="chip-group">
                    <ActionButton>Library</ActionButton>
                    <ActionButton>New</ActionButton>
                  </div>
                </section>
              </aside>
            </PatternCard>
            <PatternCard name="PanelShell.RightSidePanel" status="under migration">
              <aside className="map-inspector">
                <div className="map-inspector-header-row">
                  <div className="map-inspector-header-actions">
                    <strong>Inspector</strong>
                    <div className="map-inspector-header-actions-right">
                      <button className="map-control-btn map-control-btn-icon" title="Hide panel" type="button">
                        <PanelRightClose aria-hidden="true" size={16} strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="map-inspector-section">
                  <p className="map-inspector-line">Section/divider cadence shared with panel shell family.</p>
                </div>
              </aside>
            </PatternCard>
            <PatternCard name="PanelShell.BottomPanel" status="under migration">
              <section className="chart-panel">
                <div className="chart-top-row">
                  <div className="chart-hover-state">
                    <span>Path Profile</span>
                  </div>
                  <div className="chart-action-row-controls">
                    <button className="chart-endpoint-swap chart-endpoint-icon" title="Full size" type="button">
                      <Maximize2 aria-hidden="true" size={16} strokeWidth={1.8} />
                    </button>
                  </div>
                </div>
                <div className="chart-action-row">
                  <div className="chart-hover-state">
                    <span>Action row cadence aligned with shell family.</span>
                  </div>
                  <div className="chart-action-row-controls">
                    <ActionButton>Save</ActionButton>
                  </div>
                </div>
              </section>
            </PatternCard>
          </div>
        </section>
      ) : null}

      {activeTab === "forms" ? (
        <section className="ui-gallery-section">
          <h3>Forms</h3>
          <div className="ui-pattern-grid">
            <PatternCard name="FormActionRow" status="under migration">
              <div className="panel-section">
                <div className="chip-group">
                  <ActionButton>Apply</ActionButton>
                  <ActionButton>Reset</ActionButton>
                  <ActionButton variant="danger">Delete</ActionButton>
                </div>
              </div>
            </PatternCard>
            <PatternCard name="Input" status="standard">
              <label className="field-grid">
                <span>Simulation Name</span>
                <input defaultValue="Mountain Relay Net" type="text" />
              </label>
              <label className="field-grid">
                <span>Clutter Height (m)</span>
                <input defaultValue={7} type="number" />
              </label>
            </PatternCard>
            <PatternCard name="Select" status="standard">
              <label className="field-grid">
                <span>Frequency Plan</span>
                <select className="locale-select" defaultValue="oslo">
                  <option value="oslo">Oslo Local 869.618</option>
                  <option value="eu">EU 868</option>
                </select>
              </label>
            </PatternCard>
            <PatternCard name="Badge" status="standard">
              <div className="chip-group ui-gallery-chip-specimen">
                <Badge variant="shared">shared</Badge>
                <Badge variant="mqtt">MQTT</Badge>
              </div>
              <VariantList variants={["private", "public", "shared", "mqtt", "local", "staging"]} />
            </PatternCard>
            <PatternCard name="UI Slider" status="standard">
              <div className="chip-group" style={{ alignItems: "flex-start" }}>
                <UiSlider
                  ariaLabel="Horizontal slider specimen"
                  max={4}
                  min={1}
                  onChange={() => undefined}
                  step={0.1}
                  value={1.5}
                />
                <UiSlider
                  ariaLabel="Vertical slider specimen"
                  max={1}
                  min={0}
                  onChange={() => undefined}
                  orientation="vertical"
                  step={0.05}
                  value={0.75}
                />
              </div>
            </PatternCard>
          </div>
        </section>
      ) : null}

      {activeTab === "notifications" ? (
        <section className="ui-gallery-section">
          <h3>Notifications</h3>
          <div className="ui-pattern-grid">
            <PatternCard name="NotificationStack" status="under migration">
              <div className="app-notification-stack app-notification-stack-gallery">
                <div className="app-notification-stack-list">
                  <div className="app-notification-item app-notification-item-info" role="status">
                    <span className="app-notification-glyph" aria-hidden="true">
                      <Info size={14} strokeWidth={2} />
                    </span>
                    <div className="app-notification-copy">
                      <span>Share link copied.</span>
                    </div>
                    <button aria-label="Dismiss notification" className="app-notification-dismiss" type="button">
                      <X aria-hidden="true" size={14} strokeWidth={2} />
                    </button>
                  </div>
                  <div className="app-notification-item app-notification-item-warning" role="status">
                    <span className="app-notification-glyph" aria-hidden="true">
                      <CircleAlert size={14} strokeWidth={2} />
                    </span>
                    <div className="app-notification-copy">
                      <span>Retrying tile 12/41.</span>
                    </div>
                    <button aria-label="Dismiss notification" className="app-notification-dismiss" type="button">
                      <X aria-hidden="true" size={14} strokeWidth={2} />
                    </button>
                  </div>
                  <div className="app-notification-item app-notification-item-error" role="alert">
                    <span className="app-notification-glyph" aria-hidden="true">
                      <CircleX size={14} strokeWidth={2} />
                    </span>
                    <div className="app-notification-copy">
                      <span>Elevation API slow.</span>
                    </div>
                    <button aria-label="Dismiss notification" className="app-notification-dismiss" type="button">
                      <X aria-hidden="true" size={14} strokeWidth={2} />
                    </button>
                  </div>
                  <div className="app-notification-item app-notification-item-success" role="status">
                    <span className="app-notification-glyph" aria-hidden="true">
                      <CircleCheck size={14} strokeWidth={2} />
                    </span>
                    <div className="app-notification-copy">
                      <span>Profile updated.</span>
                    </div>
                    <button aria-label="Dismiss notification" className="app-notification-dismiss" type="button">
                      <X aria-hidden="true" size={14} strokeWidth={2} />
                    </button>
                  </div>
                </div>
                <div className="app-notification-stack-controls">
                  <ActionButton>Dismiss all</ActionButton>
                </div>
              </div>
            </PatternCard>
            <PatternCard name="NotificationBanner" status="legacy">
              <div className="notification-banner" role="status">
                <strong>2 moderator notifications</strong> need review.
              </div>
              <div className="notification-banner" role="status">
                <strong>Schema warning:</strong> missing optional index metadata.
              </div>
            </PatternCard>
            <PatternCard name="MapInlineNotice" status="exception">
              <div className="ui-gallery-map-notice-stage">
                <div className="map-inline-notice map-inline-notice-warning" role="status">
                  <span>Offline mode active. Changes will sync later.</span>
                  <ActionButton>Dismiss</ActionButton>
                </div>
              </div>
            </PatternCard>
            <PatternCard name="OfflineBanner" status="legacy">
              <div className="offline-banner" role="status">
                <span>Offline. Changes are saved locally and will sync when connection returns.</span>
                <div className="chip-group">
                  <ActionButton>Open Sync Status</ActionButton>
                  <ActionButton>Dismiss</ActionButton>
                </div>
              </div>
            </PatternCard>
            <PatternCard name="NotificationBell" status="exception">
              <div className="chip-group">
                <button className="notification-bell" type="button">
                  🔔
                  <span className="notification-badge">3</span>
                </button>
              </div>
            </PatternCard>
          </div>
        </section>
      ) : null}

      {activeTab === "states" ? (
        <section className="ui-gallery-section">
          <h3>States</h3>
          <div className="ui-pattern-grid">
            <PatternCard name="EmptyState" status="standard">
              <div className="chart-empty">No profile available for current selection.</div>
            </PatternCard>
            <PatternCard name="LoadingState" status="standard">
              <div className="map-progress-track">
                <div className="map-progress-fill map-progress-fill-indeterminate" />
              </div>
              <p className="field-help">Loading terrain and profile data…</p>
            </PatternCard>
            <PatternCard name="ErrorHelperStates" status="under migration">
              <p className="field-help field-help-error">Name must be at least 3 characters.</p>
              <div className="terrain-alert">
                <p>Terrain fetch failed for one tile. Retry when network is stable.</p>
              </div>
            </PatternCard>
          </div>
        </section>
      ) : null}

      {activeTab === "meta-map-ui" ? (
        <section className="ui-gallery-section">
          <h3>Meta / Map UI</h3>
          <div className="ui-pattern-grid">
            <PatternCard name="MapControls" status="standard">
              <div className="map-controls map-controls-unified">
                <div className="map-controls-group">
                  <button className="map-control-btn map-control-btn-icon" title="Layers" type="button">
                    <Layers aria-hidden="true" size={16} strokeWidth={1.8} />
                  </button>
                  <button className="map-control-btn map-control-btn-icon" title="Refresh" type="button">
                    <RefreshCw aria-hidden="true" size={16} strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            </PatternCard>
            <PatternCard name="SidebarFooter" status="standard">
              <footer className="sidebar-footer">
                <div className="sidebar-footer-links">
                  <span>©</span>
                  <a href="https://maplibre.org" rel="noreferrer" target="_blank">
                    MapLibre
                  </a>
                  <span>©</span>
                  <a href="https://www.openstreetmap.org" rel="noreferrer" target="_blank">
                    OpenStreetMap
                  </a>
                </div>
                <div className="sidebar-footer-version">Build: v0.14.0-beta+fc9813a</div>
              </footer>
            </PatternCard>
            <PatternCard name="StateDot" status="standard">
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <StateDot state="pass_clear" />
                <StateDot state="pass_blocked" />
                <StateDot state="fail_clear" />
                <StateDot state="fail_blocked" />
              </div>
              <VariantList variants={["pass_clear", "pass_blocked", "fail_clear", "fail_blocked"]} />
            </PatternCard>
            <PatternCard name="Surface.Pill" status="standard">
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-start" }}>
                <Surface variant="pill" style={{ padding: "8px 14px", display: "inline-flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.75rem" }}>
                    <StateDot state="pass_clear" />
                    <span>Visible + pass</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.75rem" }}>
                    <StateDot state="pass_blocked" />
                    <span>Blocked + pass</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.75rem" }}>
                    <StateDot state="fail_clear" />
                    <span>Visible + fail</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.75rem" }}>
                    <StateDot state="fail_blocked" />
                    <span>Blocked + fail</span>
                  </div>
                </Surface>
                <p className="field-help" style={{ marginTop: 0 }}>Strict pill shape (border-radius: 999px) for tall or long content such as label lists and narrow context menus. Uses the base <code>ui-surface-pill</code> class.</p>
              </div>
              <VariantList variants={["pill", "card"]} />
            </PatternCard>
            <PatternCard name="Surface.Card" status="standard">
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-start" }}>
                <Surface variant="card" style={{ padding: "12px 16px", display: "inline-grid", gap: "8px", minWidth: "160px" }}>
                  <strong style={{ fontSize: "0.75rem" }}>Signal overview</strong>
                  <div style={{ display: "grid", gap: "4px", fontSize: "0.7rem", color: "var(--muted)" }}>
                    <span>Azimuth: 142°</span>
                    <span>Distance: 12.4 km</span>
                    <span>State: Visible + pass</span>
                  </div>
                </Surface>
                <p className="field-help" style={{ marginTop: 0 }}>Card variant (border-radius: 12px) for larger, square-ish popovers with structured content. Add <code>is-card</code> modifier to <code>ui-surface-pill</code>.</p>
              </div>
            </PatternCard>
          </div>
        </section>
      ) : null}

      {activeTab === "theme" ? (
        <section className="ui-gallery-section">
          <h3>Theme Tokens</h3>
          <p className="field-help">All CSS custom properties set by the theme system. Values reflect current theme mode and color theme.</p>

          <h4 className="ui-theme-category">Semantic (Primary)</h4>
          <p className="field-help" style={{ fontSize: "0.75rem", marginBottom: "8px" }}>Core surface and content colors</p>
          <div className="ui-pattern-grid ui-pattern-grid-theme">
            {THEME_TOKENS.semanticPrimary.map(({ token, label }) => {
              const varKey = getCssVarKey(token);
              const value = variant.cssVars[varKey] ?? "—";
              return (
                <article key={token} className="ui-pattern-card">
                  <header className="ui-pattern-card-header">
                    <strong>{label}</strong>
                    <span className="ui-pattern-source">{varKey}</span>
                  </header>
                  <div className="ui-pattern-card-body">
                    <div className="ui-theme-token">
                      <div
                        className="ui-theme-swatch"
                        style={{ backgroundColor: value.startsWith("var(") ? undefined : value }}
                      />
                      <code className="ui-theme-value">{value}</code>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <h4 className="ui-theme-category">Semantic (Secondary)</h4>
          <p className="field-help" style={{ fontSize: "0.75rem", marginBottom: "8px" }}>Selection, frames, and focus</p>
          <div className="ui-pattern-grid ui-pattern-grid-theme">
            {THEME_TOKENS.semanticSecondary.map(({ token, label }) => {
              const varKey = getCssVarKey(token);
              const value = variant.cssVars[varKey] ?? "—";
              return (
                <article key={token} className="ui-pattern-card">
                  <header className="ui-pattern-card-header">
                    <strong>{label}</strong>
                    <span className="ui-pattern-source">{varKey}</span>
                  </header>
                  <div className="ui-pattern-card-body">
                    <div className="ui-theme-token">
                      <div
                        className="ui-theme-swatch"
                        style={{ backgroundColor: value.startsWith("var(") ? undefined : value }}
                      />
                      <code className="ui-theme-value">{value}</code>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <h4 className="ui-theme-category">Visualization</h4>
          <p className="field-help" style={{ fontSize: "0.75rem", marginBottom: "8px" }}>Map and chart rendering colors</p>
          <div className="ui-pattern-grid ui-pattern-grid-theme">
            {THEME_TOKENS.visualization.map(({ token, label }) => {
              const varKey = getCssVarKey(token);
              const value = variant.cssVars[varKey] ?? "—";
              return (
                <article key={token} className="ui-pattern-card">
                  <header className="ui-pattern-card-header">
                    <strong>{label}</strong>
                    <span className="ui-pattern-source">{varKey}</span>
                  </header>
                  <div className="ui-pattern-card-body">
                    <div className="ui-theme-token">
                      <div
                        className="ui-theme-swatch"
                        style={{ backgroundColor: value.startsWith("var(") ? undefined : value }}
                      />
                      <code className="ui-theme-value">{value}</code>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <h4 className="ui-theme-category">Compatibility (Derived)</h4>
          <p className="field-help" style={{ fontSize: "0.75rem", marginBottom: "8px" }}>Mixed/soft variants and elevation</p>
          <div className="ui-pattern-grid ui-pattern-grid-theme">
            {THEME_TOKENS.compatibility.map(({ token, label }) => {
              const varKey = getCssVarKey(token);
              const value = variant.cssVars[varKey] ?? "—";
              return (
                <article key={token} className="ui-pattern-card">
                  <header className="ui-pattern-card-header">
                    <strong>{label}</strong>
                    <span className="ui-pattern-source">{varKey}</span>
                  </header>
                  <div className="ui-pattern-card-body">
                    <div className="ui-theme-token">
                      <div
                        className="ui-theme-swatch"
                        style={{ backgroundColor: value.startsWith("var(") ? undefined : value }}
                      />
                      <code className="ui-theme-value">{value}</code>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <h4 className="ui-theme-category">State (CSS-only)</h4>
          <p className="field-help" style={{ fontSize: "0.75rem", marginBottom: "8px" }}>Defined in CSS, reference theme tokens.</p>
          <div className="ui-pattern-grid ui-pattern-grid-theme">
            {(["state-pass-clear", "state-pass-blocked", "state-fail-clear", "state-fail-blocked"] as const).map((token) => {
              const varKey = `--${token}`;
              return (
                <article key={token} className="ui-pattern-card">
                  <header className="ui-pattern-card-header">
                    <strong>{token.replace("state-", "")}</strong>
                    <span className="ui-pattern-source">{varKey}</span>
                  </header>
                  <div className="ui-pattern-card-body">
                    <div className="ui-theme-token">
                      <StateToken varKey={varKey} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </main>
  );
}
