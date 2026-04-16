// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CloudUser } from "../../lib/cloudUser";
import { SettingsPanel } from "./SettingsPanel";

// Stub sub-sections so SettingsPanel tests focus on panel-level behaviour.
vi.mock("./sections/ProfileSection", () => ({
  ProfileSection: () => <div data-testid="profile-section">Profile Section</div>,
}));
vi.mock("./sections/PreferencesSection", () => ({
  PreferencesSection: () => <div data-testid="preferences-section">Preferences Section</div>,
}));
vi.mock("../UserAdminPanel", () => ({
  UserAdminPanel: () => <div data-testid="admin-panel">Admin Panel</div>,
}));
vi.mock("../../lib/cloudUser", () => ({
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

  it("switches to Preferences section when its nav item is clicked", () => {
    render(<SettingsPanel initialSection={null} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /preferences/i }));
    expect(screen.getByTestId("preferences-section")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-section")).not.toBeInTheDocument();
  });
});
