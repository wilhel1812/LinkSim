// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CloudUser } from "../../../lib/cloudUser";
import { ProfileSection } from "./ProfileSection";

const passkeys = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../../../lib/betterAuthPilot", () => ({
  listBetterAuthPasskeys: passkeys.list,
  addBetterAuthPasskey: passkeys.add,
  renameBetterAuthPasskey: passkeys.update,
  removeBetterAuthPasskey: passkeys.remove,
  getPasskeyUiErrorMessage: (error: Error, operation: string) =>
    operation === "remove" && error.message === "Session is not fresh"
      ? "Your sign-in is too old to remove the passkey. Sign out, sign in with GitHub again, and retry within five minutes."
      : "Actionable passkey error",
}));

vi.mock("../../../store/appStore", () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({
    setCurrentUser: vi.fn(),
    setAuthState: vi.fn(),
  }),
}));

vi.mock("../AvatarDropZone", () => ({ AvatarDropZone: () => <div>Avatar</div> }));

const me = {
  id: "linksim-1",
  username: "Alice",
  email: "alice@example.invalid",
  bio: "",
  avatarUrl: "",
  isAdmin: false,
  isModerator: false,
  isApproved: true,
  createdAt: "2026-01-01T00:00:00.000Z",
} as CloudUser;

describe("Profile passkey management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    passkeys.list.mockResolvedValue([
      { id: "secret-credential-id", name: "MacBook", createdAt: new Date("2026-09-20T10:00:00.000Z") },
      { id: "second-secret-id", name: null, createdAt: new Date(0) },
    ]);
    passkeys.add.mockResolvedValue(undefined);
    passkeys.update.mockResolvedValue(undefined);
    passkeys.remove.mockResolvedValue(undefined);
  });

  it("does not expose passkey management outside a Better Auth session", () => {
    render(<ProfileSection me={me} onMeUpdated={vi.fn()} passkeysEnabled={false} />);
    expect(screen.queryByRole("heading", { name: "Passkeys" })).not.toBeInTheDocument();
    expect(passkeys.list).not.toHaveBeenCalled();
  });

  it("lists safe labels and dates without exposing credential ids", async () => {
    render(<ProfileSection me={me} onMeUpdated={vi.fn()} passkeysEnabled />);
    expect(await screen.findByText("MacBook")).toBeInTheDocument();
    expect(screen.getByText("Unnamed passkey")).toBeInTheDocument();
    expect(screen.queryByText("secret-credential-id")).not.toBeInTheDocument();
    expect(screen.getByText(/GitHub remains your recovery method/i)).toBeInTheDocument();
  });

  it("adds, renames, and removes credentials then refreshes the list", async () => {
    render(<ProfileSection me={me} onMeUpdated={vi.fn()} passkeysEnabled />);
    await screen.findByText("MacBook");

    fireEvent.change(screen.getByLabelText("New passkey name"), { target: { value: "Phone" } });
    fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));
    await waitFor(() => expect(passkeys.add).toHaveBeenCalledWith("Phone"));

    fireEvent.change(screen.getByLabelText("Rename MacBook"), { target: { value: "Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Save MacBook name" }));
    await waitFor(() => expect(passkeys.update).toHaveBeenCalledWith("secret-credential-id", "Laptop"));

    fireEvent.click(screen.getByRole("button", { name: "Remove MacBook" }));
    await waitFor(() => expect(passkeys.remove).toHaveBeenCalledWith("secret-credential-id"));
    expect(passkeys.list.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("explains how to recover from a stale credential-management session", async () => {
    passkeys.remove.mockRejectedValue(new Error("Session is not fresh"));
    render(<ProfileSection me={me} onMeUpdated={vi.fn()} passkeysEnabled />);
    await screen.findByText("MacBook");
    fireEvent.click(screen.getByRole("button", { name: "Remove MacBook" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your sign-in is too old to remove the passkey. Sign out, sign in with GitHub again, and retry within five minutes.",
    );
    expect(passkeys.remove).toHaveBeenCalledTimes(1);
  });
});
