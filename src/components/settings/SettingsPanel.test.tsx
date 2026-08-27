// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CloudUser } from "../../lib/cloudUser";
import { SettingsPanel } from "./SettingsPanel";

// Stub sub-sections so SettingsPanel tests focus on panel-level behaviour.
vi.mock("./sections/ProfileSection", () => ({
  ProfileSection: ({ onSignOut }: { onSignOut?: () => void }) => (
    <div data-testid="profile-section">
      Profile Section
      {onSignOut ? <button onClick={onSignOut}>Sign out</button> : null}
    </div>
  ),
}));
vi.mock("./sections/PreferencesSection", () => ({
  PreferencesSection: ({ me, onMeUpdated }: {
    me: CloudUser | null;
    onMeUpdated: (user: CloudUser, patch?: Partial<CloudUser>) => void;
  }) => <div data-testid="preferences-section">
    Preferences Section
    <span data-testid="preference-values">{me?.defaultFrequencyPresetId}:{me?.basemapPreferences?.customSources[0]?.lightUrl}</span>
    <button onClick={() => onMeUpdated({
      ...me!,
      defaultFrequencyPresetId: "old-radio",
      basemapPreferences: { version: 1, customSources: [{ id: "field", name: "Field", kind: "style", lightUrl: "https://maps.test/new.json", attribution: "Field" }] },
    }, { basemapPreferences: me?.basemapPreferences })}>Apply late map response</button>
    <button onClick={() => onMeUpdated({
      ...me!,
      defaultFrequencyPresetId: "new-radio",
      basemapPreferences: { version: 1, customSources: [] },
    }, { defaultFrequencyPresetId: "new-radio" })}>Apply radio response</button>
  </div>,
}));
vi.mock("../UserAdminPanel", () => ({
  UserAdminPanel: () => <div data-testid="admin-panel">Admin Panel</div>,
}));
vi.mock("../../lib/cloudUser", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/cloudUser")>(),
  fetchMe: vi.fn().mockResolvedValue(null),
}));

// Shared mock state — mutate currentUser per test for admin/non-admin scenarios.
const { mockState } = vi.hoisted(() => {
  const mockState: {
    currentUser: CloudUser | null;
    setCurrentUser: ReturnType<typeof vi.fn>;
    authState: "checking" | "signed_in" | "signed_out";
    setAuthState: ReturnType<typeof vi.fn>;
  } = {
    currentUser: null,
    setCurrentUser: vi.fn(),
    authState: "checking",
    setAuthState: vi.fn(),
  };
  return { mockState };
});

vi.mock("../../store/appStore", () => ({
  useAppStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

beforeEach(() => {
  // Reset to non-admin, signed-out state.
  mockState.currentUser = null;
  mockState.authState = "checking";

  // Stub history methods to avoid jsdom URL errors.
  vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  const storageValues = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storageValues.get(key) ?? null,
      setItem: (key: string, value: string) => storageValues.set(key, String(value)),
      removeItem: (key: string) => storageValues.delete(key),
      clear: () => storageValues.clear(),
      key: (index: number) => Array.from(storageValues.keys())[index] ?? null,
      get length() {
        return storageValues.size;
      },
    },
  });
});

describe("SettingsPanel", () => {
  it("renders the Settings dialog with a close button", () => {
    render(<SettingsPanel initialSection={null} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close settings/i })).toBeInTheDocument();
  });

  it("shows the Profile section by default (initialSection = null)", () => {
    render(<SettingsPanel initialSection={null} onClose={vi.fn()} />);
    expect(screen.getByTestId("profile-section")).toBeInTheDocument();
    expect(screen.queryByTestId("preferences-section")).not.toBeInTheDocument();
  });

  it("shows the Preferences section when initialSection = 'preferences'", () => {
    render(<SettingsPanel initialSection="preferences" onClose={vi.fn()} />);
    expect(screen.getByTestId("preferences-section")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-section")).not.toBeInTheDocument();
  });

  it("merges inverted profile responses by the fields each request patched", () => {
    mockState.currentUser = {
      id: "u1",
      username: "Alice",
      bio: "",
      avatarUrl: "",
      isAdmin: false,
      isApproved: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      defaultFrequencyPresetId: "old-radio",
      basemapPreferences: { version: 1, customSources: [] },
    };
    render(<SettingsPanel initialSection="preferences" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Apply radio response" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply late map response" }));

    expect(screen.getByTestId("preference-values")).toHaveTextContent("new-radio:https://maps.test/new.json");
    expect(mockState.setCurrentUser).toHaveBeenLastCalledWith(expect.objectContaining({
      defaultFrequencyPresetId: "new-radio",
      basemapPreferences: expect.objectContaining({ customSources: [expect.objectContaining({ id: "field" })] }),
    }));
  });

  it("does not show the Admin nav item for a non-admin user", () => {
    mockState.currentUser = {
      id: "u1",
      username: "Alice",
      email: "alice@example.com",
      isAdmin: false,
      isModerator: false,
      isApproved: true,
    } as CloudUser;
    mockState.authState = "signed_in";
    render(<SettingsPanel initialSection={null} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /admin/i })).not.toBeInTheDocument();
  });

  it("shows the Admin nav item for an admin user", () => {
    mockState.currentUser = {
      id: "u2",
      username: "Bob",
      email: "bob@example.com",
      isAdmin: true,
      isModerator: false,
      isApproved: true,
    } as CloudUser;
    mockState.authState = "signed_in";
    render(<SettingsPanel initialSection={null} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /admin/i })).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<SettingsPanel initialSection={null} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close settings/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the Escape key is pressed", () => {
    const onClose = vi.fn();
    render(<SettingsPanel initialSection={null} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not close or steal focus while suspended under another modal", () => {
    const onClose = vi.fn();
    const outsideButton = document.createElement("button");
    document.body.append(outsideButton);
    outsideButton.focus();
    render(<SettingsPanel initialSection={null} onClose={onClose} suspended />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outsideButton);
    outsideButton.remove();
  });

  it("clears the authenticated-session marker on explicit sign out", () => {
    mockState.currentUser = {
      id: "u1",
      username: "Alice",
      email: "alice@example.com",
      isAdmin: false,
      isModerator: false,
      isApproved: true,
    } as CloudUser;
    mockState.authState = "signed_in";
    localStorage.setItem("linksim:had-authenticated-session:v1", "1");

    render(<SettingsPanel initialSection={null} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(localStorage.getItem("linksim:had-authenticated-session:v1")).toBeNull();
  });

  it("switches to Preferences section when its nav item is clicked", () => {
    render(<SettingsPanel initialSection={null} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /preferences/i }));
    expect(screen.getByTestId("preferences-section")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-section")).not.toBeInTheDocument();
  });

  it("uses a hamburger control to return to the mobile section list", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    render(<SettingsPanel initialSection="preferences" onClose={vi.fn()} />);
    expect(screen.getByTestId("preferences-section")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Settings sections" }));
    expect(screen.queryByTestId("preferences-section")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
