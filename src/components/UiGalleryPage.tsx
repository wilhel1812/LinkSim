import { useEffect, type ReactNode } from "react";
import { Layers, Maximize2, PanelRightClose, RefreshCw } from "lucide-react";
import { ActionButton } from "./ActionButton";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { useAppStore } from "../store/appStore";

type GalleryStatus = "standard" | "exception" | "legacy" | "under migration";

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
        <p className="field-help">Live pattern dictionary using real app classes/components. Route: /ui-gallery</p>
        <div className="chip-group ui-gallery-theme-toggle">
          <ActionButton
            aria-pressed={uiThemePreference === "system"}
            onClick={() => setUiThemePreference("system")}
            type="button"
          >
            System
          </ActionButton>
          <ActionButton
            aria-pressed={uiThemePreference === "light"}
            onClick={() => setUiThemePreference("light")}
            type="button"
          >
            Light
          </ActionButton>
          <ActionButton aria-pressed={uiThemePreference === "dark"} onClick={() => setUiThemePreference("dark")} type="button">
            Dark
          </ActionButton>
        </div>
      </header>

      <section className="ui-gallery-section">
        <h3>PanelShell + PanelHeader</h3>
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
                  <span className="field-help">PanelHeader</span>
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
                <p className="map-inspector-line">Header/action cluster rhythm aligned with shell family.</p>
                <div className="chip-group">
                  <ActionButton>Details</ActionButton>
                  <ActionButton variant="danger">Remove</ActionButton>
                </div>
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
                  <span>Section/divider cadence aligned with right shell.</span>
                </div>
                <div className="chart-action-row-controls">
                  <ActionButton>Save</ActionButton>
                </div>
              </div>
            </section>
          </PatternCard>
        </div>
      </section>

      <section className="ui-gallery-section">
        <h3>ActionButton + ToolButton + FormActionRow</h3>
        <div className="ui-pattern-grid">
          <PatternCard name="ActionButton" status="under migration">
            <div className="chip-group">
              <ActionButton>Save Selected Path</ActionButton>
              <ActionButton>Details</ActionButton>
              <ActionButton variant="danger">Remove From Simulation</ActionButton>
            </div>
          </PatternCard>
          <PatternCard name="ToolButton" status="standard">
            <div className="chip-group">
              <button className="map-control-btn map-control-btn-icon" title="Layers" type="button">
                <Layers aria-hidden="true" size={16} strokeWidth={1.8} />
              </button>
              <button className="map-control-btn map-control-btn-icon" title="Refresh" type="button">
                <RefreshCw aria-hidden="true" size={16} strokeWidth={1.8} />
              </button>
              <button className="map-control-btn is-selected" type="button">
                Pass/Fail
              </button>
            </div>
          </PatternCard>
          <PatternCard name="FormActionRow" status="under migration">
            <div className="panel-section">
              <div className="chip-group">
                <ActionButton>Apply</ActionButton>
                <ActionButton>Reset</ActionButton>
                <ActionButton variant="danger">Delete</ActionButton>
              </div>
            </div>
          </PatternCard>
        </div>
      </section>

      <section className="ui-gallery-section">
        <h3>Section/Divider + Inputs/Chips/Notices</h3>
        <div className="ui-pattern-grid">
          <PatternCard name="Section/Divider" status="standard">
            <div className="map-inspector-section">
              <p className="field-help">First section block</p>
            </div>
            <div className="map-inspector-section">
              <p className="field-help">Second section block (divider above)</p>
            </div>
          </PatternCard>
          <PatternCard name="Input + Select + Chip" status="standard">
            <label className="field-grid">
              <span>Simulation Name</span>
              <input defaultValue="Mountain Relay Net" type="text" />
            </label>
            <label className="field-grid">
              <span>Frequency Preset</span>
              <select className="locale-select" defaultValue="oslo">
                <option value="oslo">Oslo Local 869.618</option>
                <option value="eu">EU 868</option>
              </select>
            </label>
            <div className="chip-group">
              <span className="access-badge">shared</span>
              <span className="access-badge mqtt-source-badge">MQTT</span>
            </div>
          </PatternCard>
          <PatternCard name="Notice Pattern" status="standard">
            <div className="notification-banner" role="status">
              Access pending approval. You can edit profile while waiting.
            </div>
            <p className="field-help">Notice styles are kept in the shell language family.</p>
          </PatternCard>
        </div>
      </section>

      <section className="ui-gallery-section">
        <h3>Exceptions / Legacy Comparison</h3>
        <div className="ui-pattern-grid">
          <PatternCard name="LinkButton (exception)" status="exception">
            <button className="inline-link-button" type="button">
              Open changelog details
            </button>
          </PatternCard>
          <PatternCard name="Compact Welcome Action (exception)" status="exception">
            <button className="inline-action welcome-compact-button" type="button">
              Start with sample simulation
            </button>
          </PatternCard>
          <PatternCard name="Legacy inline-action specimen" status="legacy">
            <div className="chip-group">
              <button className="inline-action" type="button">
                Legacy Inline Action
              </button>
            </div>
            <p className="field-help">Kept only as comparison reference while migration remains incomplete.</p>
          </PatternCard>
        </div>
      </section>
    </main>
  );
}
