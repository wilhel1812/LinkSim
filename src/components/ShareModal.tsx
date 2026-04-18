import { Copy, Globe, UserRoundPlus, UserRoundSearch, Users } from "lucide-react";
import { useState } from "react";
import type { CollaboratorDirectoryUser } from "../lib/cloudUser";
import { ActionButton } from "./ActionButton";
import { ExportComposer, type ExportComposerProps } from "./ExportComposer";
import { InlineCloseIconButton } from "./InlineCloseIconButton";
import { ModalOverlay } from "./ModalOverlay";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShareTab = "export" | "share";

export type ShareModalProps = {
  onClose: () => void;

  // Export tab
  exportProps: ExportComposerProps;

  // Share tab — link section
  /** Undefined when no simulation is open. */
  currentShareLink: string | undefined;
  onCopyLink: () => void;

  // Share tab — access control (only rendered for private simulations)
  isPrivate: boolean;
  shareBusy: boolean;
  /** Number of private sites referenced by this simulation. */
  referencedPrivateSiteCount: number;
  /** Whether the current user can edit the simulation (required for upgrade). */
  canUpgrade: boolean;
  onUpgradeAndShare: () => void;

  shareSpecificUsers: string[];
  shareSpecificRoles: Record<string, "viewer" | "editor">;
  onSetSpecificRoles: (uid: string, role: "viewer" | "editor") => void;
  shareDirectory: CollaboratorDirectoryUser[];
  shareDirectoryBusy: boolean;
  shareUserQuery: string;
  onShareUserQueryChange: (q: string) => void;
  onAddUser: (uid: string) => void;
  onRemoveUser: (uid: string) => void;
  shareSpecificBusy: boolean;
  shareSpecificStatus: string;
  onShareWithSpecificUsers: () => void;
  currentUserId: string | undefined;
};

// ---------------------------------------------------------------------------
// ShareModal
// ---------------------------------------------------------------------------

export function ShareModal({
  onClose,
  exportProps,
  currentShareLink,
  onCopyLink,
  isPrivate,
  shareBusy,
  referencedPrivateSiteCount,
  canUpgrade,
  onUpgradeAndShare,
  shareSpecificUsers,
  shareSpecificRoles,
  onSetSpecificRoles,
  shareDirectory,
  shareDirectoryBusy,
  shareUserQuery,
  onShareUserQueryChange,
  onAddUser,
  onRemoveUser,
  shareSpecificBusy,
  shareSpecificStatus,
  onShareWithSpecificUsers,
  currentUserId,
}: ShareModalProps) {
  const [activeTab, setActiveTab] = useState<ShareTab>("export");

  return (
    <ModalOverlay aria-label="Share simulation" onClose={onClose}>
      <div className="library-manager-card share-modal">
        {/* Header */}
        <div className="library-manager-header">
          <h2>Share</h2>
          <InlineCloseIconButton onClick={onClose} />
        </div>

        {/* Tabs */}
        <div className="share-modal-tabs" role="tablist">
          <button
            aria-controls="share-tab-export"
            aria-selected={activeTab === "export"}
            className={`share-modal-tab${activeTab === "export" ? " is-active" : ""}`}
            id="share-tab-export-btn"
            onClick={() => setActiveTab("export")}
            role="tab"
            type="button"
          >
            Export
          </button>
          <button
            aria-controls="share-tab-share"
            aria-selected={activeTab === "share"}
            className={`share-modal-tab${activeTab === "share" ? " is-active" : ""}`}
            id="share-tab-share-btn"
            onClick={() => setActiveTab("share")}
            role="tab"
            type="button"
          >
            Share link
          </button>
        </div>

        {/* Export tab */}
        {activeTab === "export" && (
          <div
            aria-labelledby="share-tab-export-btn"
            id="share-tab-export"
            role="tabpanel"
          >
            <ExportComposer {...exportProps} />
          </div>
        )}

        {/* Share tab */}
        {activeTab === "share" && (
          <div
            aria-labelledby="share-tab-share-btn"
            id="share-tab-share"
            role="tabpanel"
          >
            {currentShareLink === undefined ? (
              <p className="field-help">Open a saved simulation first. Unsaved workspace state cannot be deep-linked.</p>
            ) : (
              <>
                <p className="field-help">This link opens the same simulation, selected path, map view, and overlay mode.</p>
                <div style={{ display: "flex", gap: "0.5em", alignItems: "center" }}>
                  <input
                    className="locale-select"
                    readOnly
                    style={{ flex: 1, minWidth: 0 }}
                    value={currentShareLink}
                  />
                  <button
                    aria-label="Copy link"
                    className="inline-action inline-action-icon"
                    onClick={onCopyLink}
                    title="Copy link"
                    type="button"
                  >
                    <Copy aria-hidden="true" strokeWidth={1.8} />
                  </button>
                </div>
                {isPrivate && (
                  <div className="panel-section compact-panel">
                    <h4>Private Simulation</h4>
                    <p className="field-help">This simulation is private. Choose how to share it:</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75em", marginTop: "0.5em" }}>
                      {/* Option A: Upgrade to shared */}
                      <div className="panel-section compact-panel" style={{ display: "flex", flexDirection: "column", gap: "0.5em" }}>
                        <Globe aria-hidden="true" size={22} strokeWidth={1.6} />
                        <strong>Make Broadly Accessible</strong>
                        <p className="field-help" style={{ flex: 1 }}>
                          Anyone with the link can view. The simulation
                          {referencedPrivateSiteCount > 0
                            ? ` and ${referencedPrivateSiteCount} referenced site(s)`
                            : ""}{" "}
                          will be set to Shared.
                          {!canUpgrade ? " Some sites require owner access." : ""}
                        </p>
                        <ActionButton
                          disabled={shareBusy || !canUpgrade}
                          onClick={onUpgradeAndShare}
                          type="button"
                        >
                          Upgrade &amp; Copy Link
                        </ActionButton>
                      </div>

                      {/* Option B: Specific users */}
                      <div className="panel-section compact-panel" style={{ display: "flex", flexDirection: "column", gap: "0.5em" }}>
                        <Users aria-hidden="true" size={22} strokeWidth={1.6} />
                        <strong>Share with Specific Users</strong>
                        <p className="field-help">
                          Stays private. Only the users you add can access the link when signed in.
                        </p>
                        {shareSpecificUsers.length > 0 && (
                          <div className="chip-group collaborator-selected-list">
                            {shareSpecificUsers.map((uid) => {
                              const user = shareDirectory.find((u) => u.id === uid);
                              return (
                                <span className="site-quick-item" key={uid}>
                                  <span>{user?.username ?? uid}</span>
                                  <select
                                    aria-label={`Role for ${user?.username ?? uid}`}
                                    onChange={(e) => onSetSpecificRoles(uid, e.target.value as "viewer" | "editor")}
                                    value={shareSpecificRoles[uid] ?? "viewer"}
                                  >
                                    <option value="viewer">Viewer</option>
                                    <option value="editor">Editor</option>
                                  </select>
                                  <ActionButton onClick={() => onRemoveUser(uid)} type="button">
                                    Remove
                                  </ActionButton>
                                </span>
                              );
                            })}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: "0.4em", alignItems: "center" }}>
                          <UserRoundSearch aria-hidden="true" size={16} strokeWidth={1.6} style={{ flexShrink: 0 }} />
                          <input
                            onChange={(e) => onShareUserQueryChange(e.target.value)}
                            placeholder="Search by name or email"
                            style={{ flex: 1, minWidth: 0 }}
                            type="text"
                            value={shareUserQuery}
                          />
                        </div>
                        {shareUserQuery.trim() && (
                          <div className="collaborator-candidate-list">
                            {shareDirectoryBusy ? (
                              <p className="field-help">Loading…</p>
                            ) : (
                              shareDirectory
                                .filter((u) => !shareSpecificUsers.includes(u.id) && u.id !== currentUserId)
                                .filter(
                                  (u) =>
                                    u.username.toLowerCase().includes(shareUserQuery.toLowerCase()) ||
                                    u.email.toLowerCase().includes(shareUserQuery.toLowerCase()),
                                )
                                .slice(0, 6)
                                .map((u) => (
                                  <button
                                    className="site-quick-item"
                                    key={u.id}
                                    onClick={() => onAddUser(u.id)}
                                    type="button"
                                  >
                                    <UserRoundPlus aria-hidden="true" size={14} strokeWidth={1.6} />
                                    <span>{u.username}</span>
                                    {u.email ? <span className="field-help">{u.email}</span> : null}
                                  </button>
                                ))
                            )}
                            {!shareDirectoryBusy &&
                              shareDirectory.filter(
                                (u) =>
                                  !shareSpecificUsers.includes(u.id) &&
                                  u.id !== currentUserId &&
                                  (u.username.toLowerCase().includes(shareUserQuery.toLowerCase()) ||
                                    u.email.toLowerCase().includes(shareUserQuery.toLowerCase())),
                              ).length === 0 && (
                                <p className="field-help">No matching users.</p>
                              )}
                          </div>
                        )}
                        <div style={{ marginTop: "auto" }}>
                          <ActionButton
                            disabled={shareSpecificBusy || !shareSpecificUsers.length}
                            onClick={onShareWithSpecificUsers}
                            style={{ display: "flex", alignItems: "center", gap: "0.35em" }}
                            type="button"
                          >
                            <Copy aria-hidden="true" size={14} strokeWidth={1.8} />
                            Save &amp; Copy Link
                          </ActionButton>
                        </div>
                        {shareSpecificStatus && (
                          <p className="field-help">{shareSpecificStatus}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </ModalOverlay>
  );
}
