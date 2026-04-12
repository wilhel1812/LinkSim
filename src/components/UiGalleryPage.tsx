import { useEffect, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleX, Info, Layers, Maximize2, Minus, PanelRightClose, Plus, RefreshCw, X } from "lucide-react";
import { ActionButton } from "./ActionButton";
import { Surface } from "./ui/Surface";
import { UiSlider } from "./UiSlider";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { useAppStore } from "../store/appStore";
import type { UiColorTheme } from "../themes/types";

type GalleryStatus = "standard" | "exception" | "legacy" | "under migration" | "mapped only";
type GalleryTab = "actions" | "panels" | "forms" | "notifications" | "states" | "meta-map-ui";

const GALLERY_TABS: Array<{ id: GalleryTab; label: string }> = [
  { id: "actions", label: "Actions" },
  { id: "panels", label: "Panels" },
  { id: "forms", label: "Forms" },
  { id: "notifications", label: "Notifications" },
  { id: "states", label: "States" },
  { id: "meta-map-ui", label: "Meta/Map UI" },
];

const statusClassName = (status: GalleryStatus) => status.replace(/\s+/g, "-");

const StatusPill = ({ status }: { status: GalleryStatus }) => (
  <span className={`ui-pattern-status is-${statusClassName(status)}`}>{status}</span>
);

const PatternCard = ({
  name,
  status,
  children,
}: {
  name: string;
  status: GalleryStatus;
  children: ReactNode;
}) => (
  <article className="ui-pattern-card">
    <header className="ui-pattern-card-header">
      <strong>{name}</strong>
      <StatusPill status={status} />
    </header>
    <div className="ui-pattern-card-body">{children}</div>
  </article>
);

export function UiGalleryPage() {
  const { theme, variant, colorTheme, activeHolidayTheme } = useThemeVariant();
  const [activeTab, setActiveTab] = useState<GalleryTab>("actions");
  const uiThemePreference = useAppStore((state) => state.uiThemePreference);
  const setUiColorTheme = useAppStore((state) => state.setUiColorTheme);
  const setUiThemePreference = useAppStore((state) => state.setUiThemePreference);
  const colorThemes: UiColorTheme[] = ["blue", "pink", "red", "green", "yellow"];

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
            </PatternCard>
            <PatternCard name="OverlayIconControl (map controls pill)" status="standard">
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
            <PatternCard name="Overlay icon controls (mapped inventory)" status="mapped only">
              <div className="chip-group">
                <button className="map-control-btn map-control-btn-icon" title="Zoom out" type="button">
                  <Minus aria-hidden="true" size={16} strokeWidth={1.8} />
                </button>
                <button className="map-control-btn map-control-btn-icon" title="Zoom in" type="button">
                  <Plus aria-hidden="true" size={16} strokeWidth={1.8} />
                </button>
                <button className="inline-action inline-action-icon" title="Close" type="button">
                  <PanelRightClose aria-hidden="true" size={16} strokeWidth={1.8} />
                </button>
              </div>
            </PatternCard>
          </div>
        </section>
      ) : null}

      {activeTab === "panels" ? (
        <section className="ui-gallery-section">
          <h3>Panels</h3>
          <div className="ui-pattern-grid ui-pattern-grid-shells">
            <PatternCard name="PanelShell.LeftSidePanel + PanelHeader" status="under migration">
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
            <PatternCard name="PanelShell.RightSidePanel + PanelHeader" status="under migration">
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
            <PatternCard name="PanelShell.BottomPanel + header/action rows" status="under migration">
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
            <PatternCard name="Input + Select + FieldGroup" status="standard">
              <label className="field-grid">
                <span>Simulation Name</span>
                <input defaultValue="Mountain Relay Net" type="text" />
              </label>
              <label className="field-grid">
                <span>Frequency Plan</span>
                <select className="locale-select" defaultValue="oslo">
                  <option value="oslo">Oslo Local 869.618</option>
                  <option value="eu">EU 868</option>
                </select>
              </label>
              <label className="field-grid">
                <span>Clutter Height (m)</span>
                <input defaultValue={7} type="number" />
              </label>
            </PatternCard>
            <PatternCard name="Badges/Chips/Pills" status="standard">
              <div className="chip-group ui-gallery-chip-specimen">
                <span className="access-badge">shared</span>
                <span className="access-badge mqtt-source-badge">MQTT</span>
                <span className="map-band-chip">Mesh</span>
              </div>
            </PatternCard>
            <PatternCard name="UI Slider Toolkit" status="standard">
              <div className="chip-group" style={{ alignItems: "flex-start" }}>
                <UiSlider
                  ariaLabel="Horizontal slider specimen"
                  label="FOV"
                  max={4}
                  min={1}
                  onChange={() => undefined}
                  step={0.1}
                  value={1.5}
                  valueLabel="240°"
                />
                <UiSlider
                  ariaLabel="Vertical slider specimen"
                  label="Vertical"
                  max={1}
                  min={0}
                  onChange={() => undefined}
                  orientation="vertical"
                  step={0.05}
                  value={0.75}
                  valueLabel="75%"
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
            <PatternCard name="Unified app notification stack (auto/manual + overflow)" status="under migration">
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
            <PatternCard name="Notification banner (legacy)" status="legacy">
              <div className="notification-banner" role="status">
                <strong>2 moderator notifications</strong> need review.
              </div>
              <div className="notification-banner" role="status">
                <strong>Schema warning:</strong> missing optional index metadata.
              </div>
            </PatternCard>
            <PatternCard name="Map inline notice baseline" status="exception">
              <div className="ui-gallery-map-notice-stage">
                <div className="map-inline-notice map-inline-notice-warning" role="status">
                  <span>Offline mode active. Changes will sync later.</span>
                  <ActionButton>Dismiss</ActionButton>
                </div>
              </div>
            </PatternCard>
            <PatternCard name="Offline banner (legacy)" status="legacy">
              <div className="offline-banner" role="status">
                <span>Offline. Changes are saved locally and will sync when connection returns.</span>
                <div className="chip-group">
                  <ActionButton>Open Sync Status</ActionButton>
                  <ActionButton>Dismiss</ActionButton>
                </div>
              </div>
            </PatternCard>
            <PatternCard name="Notification bell + badge" status="exception">
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
            <PatternCard name="Empty state" status="standard">
              <div className="chart-empty">No profile available for current selection.</div>
            </PatternCard>
            <PatternCard name="Loading state" status="standard">
              <div className="map-progress-track">
                <div className="map-progress-fill map-progress-fill-indeterminate" />
              </div>
              <p className="field-help">Loading terrain and profile data…</p>
            </PatternCard>
            <PatternCard name="Error/helper states" status="under migration">
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
            <PatternCard name="Map control cluster (overlay family)" status="standard">
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
            <PatternCard name="Attribution / low-priority meta UI" status="standard">
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
            <PatternCard name="Popover — pill variant (tall / label use-case)" status="standard">
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-start" }}>
                <Surface variant="pill" style={{ padding: "8px 14px", display: "inline-flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.75rem" }}>
                    <span className="state-dot state-dot-pass_clear" aria-hidden />
                    <span>Visible + pass</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.75rem" }}>
                    <span className="state-dot state-dot-pass_blocked" aria-hidden />
                    <span>Blocked + pass</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.75rem" }}>
                    <span className="state-dot state-dot-fail_clear" aria-hidden />
                    <span>Visible + fail</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.75rem" }}>
                    <span className="state-dot state-dot-fail_blocked" aria-hidden />
                    <span>Blocked + fail</span>
                  </div>
                </Surface>
                <p className="field-help" style={{ marginTop: 0 }}>Strict pill shape (border-radius: 999px) for tall or long content such as label lists and narrow context menus. Uses the base <code>ui-surface-pill</code> class.</p>
              </div>
            </PatternCard>
            <PatternCard name="Popover — card variant (square / content-rich use-case)" status="standard">
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
            <PatternCard name="Icon-only controls policy" status="mapped only">
              <p className="field-help">Mapped for taxonomy coverage only in this pass. No visual convergence or restyling is applied.</p>
            </PatternCard>
          </div>
        </section>
      ) : null}
    </main>
  );
}
