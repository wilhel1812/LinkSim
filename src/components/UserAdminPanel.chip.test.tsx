// @vitest-environment jsdom
// Tests for the UserAdminPanel chip's onOpenSettings integration.
// Only covers the chip-row UI; the full modal and admin-inline mode are
// better suited to Playwright given their network and canvas dependencies.
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchUserDirectory,
  fetchUsers,
  fetchAdminAuditEvents,
  fetchAuthDiagnostics,
  fetchSchemaDiagnostics,
} from "../lib/cloudUser";
import { fetchNotifications } from "../lib/cloudNotifications";
import type { CloudUser } from "../lib/cloudUser";
import { UserAdminPanel } from "./UserAdminPanel";

// --- Module mocks ----------------------------------------------------------

const { fetchMeMock } = vi.hoisted(() => ({
  fetchMeMock: vi.fn(),
}));

vi.mock("../lib/cloudUser", () => ({
  fetchMe: fetchMeMock,
  fetchUsers: vi.fn().mockResolvedValue([]),
  fetchUserDirectory: vi.fn().mockResolvedValue({
    users: [],
    authMigrationAvailable: true,
    authMigrationProgress: { migrated: 0, total: 0 },
  }),
  fetchAdminAuditEvents: vi.fn().mockResolvedValue([]),
  fetchAuthDiagnostics: vi.fn().mockResolvedValue({ auth: { signals: {} } }),
  fetchSchemaDiagnostics: vi.fn().mockResolvedValue({ schema: { version: "test", missing: [] } }),
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
  vi.clearAllMocks();
  vi.mocked(fetchUsers).mockResolvedValue([]);
  vi.mocked(fetchUserDirectory).mockResolvedValue({
    users: [],
    authMigrationAvailable: true,
    authMigrationProgress: { migrated: 0, total: 0 },
  });
  mockStoreState.currentUser = signedInUser;
  mockStoreState.authState = "signed_in";
  fetchMeMock.mockResolvedValue(signedInUser);
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

  it("exposes a Stats link from the signed-in account actions", async () => {
    render(<UserAdminPanel onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("link", { name: /open stats/i })).toHaveAttribute("href", "/stats");
    await waitFor(() => expect(screen.getByRole("link", { name: /open stats/i })).toBeInTheDocument());
  });

  it("shows the sign-in button instead of the chip when signed out", () => {
    mockStoreState.authState = "signed_out";
    mockStoreState.currentUser = null;
    render(<UserAdminPanel />);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open user settings/i })).not.toBeInTheDocument();
  });

  it("reuses the sign-in chip for the pilot while retaining the Access profile", async () => {
    const onSignInRequested = vi.fn();

    render(<UserAdminPanel onSignInRequested={onSignInRequested} showSignInForAccessPilot />);

    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(onSignInRequested).toHaveBeenCalledOnce();
    expect(mockStoreState.currentUser).toBe(signedInUser);
    expect(screen.getAllByRole("button", { name: /open user settings/i })).toHaveLength(1);
  });

  it("uses one sign-in trigger instead of a separate passkey toolbar action", () => {
    render(<UserAdminPanel onSignInRequested={vi.fn()} showSignInForAccessPilot />);

    expect(screen.getAllByRole("button", { name: /sign in/i })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Sign in with a passkey" })).not.toBeInTheDocument();
  });

  it("does not fetch the protected profile while auth is still checking", () => {
    mockStoreState.authState = "checking";
    mockStoreState.currentUser = null;

    render(<UserAdminPanel />);

    expect(fetchMeMock).not.toHaveBeenCalled();
  });
});

it("reuses the authenticated profile and does not preload admin data in the chip", async () => {
  mockStoreState.currentUser = { ...signedInUser, isAdmin: true };
  fetchMeMock.mockResolvedValue(mockStoreState.currentUser);
  render(<UserAdminPanel />);
  await waitFor(() => expect(screen.getByRole("link", { name: /open stats/i })).toBeInTheDocument());
  expect(fetchMeMock).not.toHaveBeenCalled();
  expect(fetchUserDirectory).not.toHaveBeenCalled();
  expect(fetchAdminAuditEvents).not.toHaveBeenCalled();
  expect(fetchAuthDiagnostics).not.toHaveBeenCalled();
  expect(fetchSchemaDiagnostics).not.toHaveBeenCalled();
});

vi.mock("./SiteNoticeAdminForm", () => ({ SiteNoticeAdminForm: () => null }));
it("loads administrator datasets only when admin settings open", async () => {
  mockStoreState.currentUser = { ...signedInUser, isAdmin: true };
  const view = render(<UserAdminPanel />);
  expect(fetchUsers).not.toHaveBeenCalled();
  view.rerender(<UserAdminPanel renderMode="admin-inline" />);
  await waitFor(() => expect(fetchUserDirectory).toHaveBeenCalledTimes(1));
  expect(fetchMeMock).not.toHaveBeenCalled();
  expect(fetchAdminAuditEvents).toHaveBeenCalledTimes(1);
  expect(fetchAuthDiagnostics).toHaveBeenCalledTimes(1);
  expect(fetchSchemaDiagnostics).toHaveBeenCalledTimes(1);
});

it("shows server migration totals independently of the capped unfiltered user directory", async () => {
  mockStoreState.currentUser = {
    ...signedInUser,
    id: "admin-1",
    username: "Admin",
    isAdmin: true,
    authMigrationState: "migrated",
  } as CloudUser;
  vi.mocked(fetchUserDirectory).mockResolvedValue({ users: [
    mockStoreState.currentUser,
    { ...signedInUser, id: "user-1", username: "Migrated", authMigrationState: "migrated" } as CloudUser,
    {
      ...signedInUser,
      id: "user-2",
      username: "Waiting",
      accountState: "pending",
      authMigrationState: "not_migrated",
    } as CloudUser,
  ], authMigrationAvailable: true, authMigrationProgress: { migrated: 2001, total: 2004 } });

  render(<UserAdminPanel renderMode="admin-inline" />);

  expect(await screen.findByText("2001 of 2004 accounts migrated")).toBeInTheDocument();
  const progress = screen.getByRole("progressbar", { name: "Authentication migration progress" });
  expect(progress).toHaveAttribute("aria-valuemin", "0");
  expect(progress).toHaveAttribute("aria-valuemax", "2004");
  expect(progress).toHaveAttribute("aria-valuenow", "2001");
  expect(screen.getByText("Migrated", { selector: ".auth-migration-state" })).toBeInTheDocument();
  expect(screen.getByText("Not migrated", { selector: ".auth-migration-state" })).toBeInTheDocument();
  expect(screen.getByText("Pending")).toBeInTheDocument();

  await userEvent.type(screen.getByPlaceholderText("Name, email, or user ID"), "Waiting");
  expect(screen.getByText("2001 of 2004 accounts migrated")).toBeInTheDocument();
});

it("shows an empty migration denominator without dividing by zero", async () => {
  mockStoreState.currentUser = { ...signedInUser, isAdmin: true } as CloudUser;
  vi.mocked(fetchUserDirectory).mockResolvedValue({
    users: [],
    authMigrationAvailable: true,
    authMigrationProgress: { migrated: 0, total: 0 },
  });

  render(<UserAdminPanel renderMode="admin-inline" />);

  expect(await screen.findByText("0 of 0 accounts migrated")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Authentication migration progress" }))
    .toHaveAttribute("aria-valuenow", "0");
});

it("does not report an empty migration denominator while the directory is loading", async () => {
  mockStoreState.currentUser = { ...signedInUser, isAdmin: true } as CloudUser;
  vi.mocked(fetchUserDirectory).mockReturnValue(new Promise(() => {}));

  render(<UserAdminPanel renderMode="admin-inline" />);

  expect(await screen.findByText("Loading authentication migration progress…")).toBeInTheDocument();
  expect(screen.queryByText("0 of 0 accounts migrated")).not.toBeInTheDocument();
  expect(screen.queryByRole("progressbar", { name: "Authentication migration progress" })).not.toBeInTheDocument();
});

it("marks migration progress unavailable when the directory load fails", async () => {
  mockStoreState.currentUser = { ...signedInUser, isAdmin: true } as CloudUser;
  vi.mocked(fetchUserDirectory).mockRejectedValue(new Error("offline"));

  render(<UserAdminPanel renderMode="admin-inline" />);

  expect(await screen.findByText("Authentication migration progress unavailable. Refresh admin data to try again."))
    .toBeInTheDocument();
  expect(screen.queryByText("0 of 0 accounts migrated")).not.toBeInTheDocument();
  expect(screen.queryByRole("progressbar", { name: "Authentication migration progress" })).not.toBeInTheDocument();
});

it("does not expose authentication migration progress to moderators", async () => {
  mockStoreState.currentUser = { ...signedInUser, isModerator: true } as CloudUser;
  vi.mocked(fetchUsers).mockResolvedValue([
    { ...signedInUser, id: "user-1" } as CloudUser,
  ]);

  render(<UserAdminPanel renderMode="admin-inline" />);

  await waitFor(() => expect(fetchUsers).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("progressbar", { name: "Authentication migration progress" })).not.toBeInTheDocument();
  expect(screen.queryByText(/accounts migrated/)).not.toBeInTheDocument();
});

it("keeps the user directory usable but marks migration progress unavailable without the auth schema", async () => {
  mockStoreState.currentUser = { ...signedInUser, isAdmin: true } as CloudUser;
  vi.mocked(fetchUserDirectory).mockResolvedValue({
    users: [{ ...signedInUser, id: "user-1" } as CloudUser],
    authMigrationAvailable: false,
    authMigrationProgress: null,
  });

  render(<UserAdminPanel renderMode="admin-inline" />);

  expect(await screen.findByText("Authentication migration progress unavailable until authentication setup is complete."))
    .toBeInTheDocument();
  expect(screen.getByText("Alice", { selector: "strong" })).toBeInTheDocument();
  expect(screen.queryByText("Not migrated", { selector: ".auth-migration-state" })).not.toBeInTheDocument();
});


it.each([false, true])("counts one-hour idle chip traffic with administrator=%s", async (isAdmin) => {
  vi.useFakeTimers();
  mockStoreState.currentUser = { ...signedInUser, isAdmin };
  const view = render(<UserAdminPanel />);
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000); });
    expect(fetchNotifications).toHaveBeenCalledTimes(isAdmin ? 121 : 0);
    expect(fetchMeMock).not.toHaveBeenCalled();
    expect(fetchUsers).not.toHaveBeenCalled();
    expect(fetchAdminAuditEvents).not.toHaveBeenCalled();
    expect(fetchAuthDiagnostics).not.toHaveBeenCalled();
    expect(fetchSchemaDiagnostics).not.toHaveBeenCalled();
  } finally { view.unmount(); vi.useRealTimers(); }
});
