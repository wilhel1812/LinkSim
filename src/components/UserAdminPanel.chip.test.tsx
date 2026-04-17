// @vitest-environment jsdom
// Tests for the UserAdminPanel chip's onOpenSettings integration.
// Only covers the chip-row UI; the full modal and admin-inline mode are
// better suited to Playwright given their network and canvas dependencies.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CloudUser } from "../lib/cloudUser";
import { UserAdminPanel } from "./UserAdminPanel";

// --- Module mocks ----------------------------------------------------------

vi.mock("../lib/cloudUser", () => ({
  fetchMe: vi.fn().mockResolvedValue(null),
  fetchUsers: vi.fn().mockResolvedValue([]),
  fetchAdminAuditEvents: vi.fn().mockResolvedValue([]),
  fetchAuthDiagnostics: vi.fn().mockResolvedValue({}),
  fetchSchemaDiagnostics: vi.fn().mockResolvedValue({}),
  fetchDeletedUsers: vi.fn().mockResolvedValue([]),
  updateMyProfile: vi.fn().mockResolvedValue(null),
  updateUserRole: vi.fn().mockResolvedValue(null),
  updateUserProfile: vi.fn().mockResolvedValue(null),
  uploadAvatar: vi.fn().mockResolvedValue(null),
  deleteUser: vi.fn().mockResolvedValue(null),
  restoreDeletedCloudUser: vi.fn().mockResolvedValue(null),
  reassignResourceOwner: vi.fn().mockResolvedValue(null),
  bulkReassignOwnership: vi.fn().mockResolvedValue(null),
  runMetadataRepair: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/cloudNotifications", () => ({
  fetchNotifications: vi.fn().mockResolvedValue({ items: [] }),
}));

vi.mock("../lib/environment", () => ({
  getCurrentRuntimeEnvironment: vi.fn().mockReturnValue("production"),
}));

const signedInUser = {
  id: "u1",
  username: "Alice",
  email: "alice@example.com",
  isAdmin: false,
  isModerator: false,
  isApproved: true,
  accountState: "active",
  bio: null,
  avatarUrl: null,
  createdAt: null,
  updatedAt: null,
} as unknown as CloudUser;

const { mockStoreState } = vi.hoisted(() => {
  const mockStoreState = {
    currentUser: null as CloudUser | null,
    authState: "signed_out" as "checking" | "signed_in" | "signed_out",
    setCurrentUser: vi.fn(),
    setAuthState: vi.fn(),
    uiThemePreference: "system" as const,
    setUiThemePreference: vi.fn(),
    uiColorTheme: "blue" as const,
    setUiColorTheme: vi.fn(),
    syncStatus: "idle" as const,
    syncPending: false,
    pendingChangesCount: 0,
    isOnline: true,
    lastSyncedAt: null,
    syncErrorMessage: null,
    performManualCloudSync: vi.fn(),
    holidayWindowState: { reverted: [], dismissed: [] },
    revertHolidayThemeForWindow: vi.fn(),
    dismissHolidayThemeNotice: vi.fn(),
  };
  return { mockStoreState };
});

vi.mock("../store/appStore", () => ({
  useAppStore: (selector: (s: typeof mockStoreState) => unknown) =>
    selector(mockStoreState),
}));

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockStoreState.currentUser = signedInUser;
  mockStoreState.authState = "signed_in";
});

describe("UserAdminPanel chip — onOpenSettings", () => {
  it("calls onOpenSettings when the user chip is clicked (signed in)", async () => {
    const onOpenSettings = vi.fn();
    render(<UserAdminPanel onOpenSettings={onOpenSettings} />);
    // Both the chip and the settings icon share the same aria-label; chip is first.
    const buttons = screen.getAllByRole("button", { name: /open user settings/i });
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    await userEvent.click(buttons[0]); // user chip
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("calls onOpenSettings from the settings icon button when signed in", async () => {
    const onOpenSettings = vi.fn();
    render(<UserAdminPanel onOpenSettings={onOpenSettings} />);
    const buttons = screen.getAllByRole("button", { name: /open user settings/i });
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    await userEvent.click(buttons[1]); // settings icon is second
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("shows the sign-in button instead of the chip when signed out", () => {
    mockStoreState.authState = "signed_out";
    mockStoreState.currentUser = null;
    render(<UserAdminPanel />);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open user settings/i })).not.toBeInTheDocument();
  });
});
