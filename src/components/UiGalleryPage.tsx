import { useEffect, useState, type ReactNode } from "react";
import { Layers, Maximize2, Minus, PanelRightClose, Plus, RefreshCw } from "lucide-react";
import { ActionButton } from "./ActionButton";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { useAppStore } from "../store/appStore";

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
  const { theme, variant } = useThemeVariant();
  const [activeTab, setActiveTab] = useState<GalleryTab>("actions");
  const uiThemePreference = useAppStore((state) => state.uiThemePreference);
  const setUiThemePreference = useAppStore((state) => state.setUiThemePreference);

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
            <PatternCard name="ToolButton (true overlay controls only)" status="standard">
              <div className="chip-group">
                <button className="map-control-btn" type="button">
                  Pass/Fail
                </button>
                <button className="map-control-btn is-selected" type="button">
                  Heatmap
                </button>
                <button className="map-control-btn" type="button">
                  Fit
                </button>
              </div>
            </PatternCard>
            <PatternCard name="LinkButton" status="exception">
              <button className="inline-link-button" type="button">
                Open change log
              </button>
            </PatternCard>
            <PatternCard name="Icon-only utility controls" status="mapped only">
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
              <div className="chip-group">
                <span className="access-badge">shared</span>
                <span className="access-badge mqtt-source-badge">MQTT</span>
                <span className="ui-pattern-status is-standard">standard</span>
              </div>
            </PatternCard>
          </div>
        </section>
      ) : null}

      {activeTab === "notifications" ? (
        <section className="ui-gallery-section">
          <h3>Notifications</h3>
          <div className="ui-pattern-grid">
            <PatternCard name="Map inline notice" status="under migration">
              <div className="map-inline-notice map-inline-notice-warning" role="status">
                <span>Offline mode active. Changes will sync later.</span>
                <ActionButton>Dismiss</ActionButton>
              </div>
            </PatternCard>
            <PatternCard name="Banner notice" status="under migration">
              <div className="notification-banner" role="status">
                <strong>2 moderator notifications</strong> need review.
              </div>
              <div className="notification-banner" role="status">
                <strong>Schema warning:</strong> missing optional index metadata.
              </div>
            </PatternCard>
            <PatternCard name="Offline banner" status="under migration">
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
            <PatternCard name="Icon-only controls policy" status="mapped only">
              <p className="field-help">Mapped for taxonomy coverage only in this pass. No visual convergence applied.</p>
            </PatternCard>
          </div>
        </section>
      ) : null}
    </main>
  );
}
