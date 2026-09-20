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
      : operation === "add" && error.message === "Auth cancelled"
        ? "Passkey creation was cancelled. No passkey was added. Try again when ready."
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
    expect(screen.getByText(/fingerprint, face, PIN, or screen lock/i)).toBeInTheDocument();
    expect(screen.getByText(/saved by your device or password manager/i)).toBeInTheDocument();
    expect(screen.getByText(/another device may show a QR code/i)).toBeInTheDocument();
    expect(screen.getByText(/GitHub remains your .*recovery method/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Learn more about passkeys" })).toHaveAttribute(
      "href",
      "https://www.passkeycentral.org/introduction-to-passkeys/",
    );
    expect(screen.getByRole("status", { name: "Passkey operation status" })).toHaveClass("sr-only");
  });

  it("adds, renames, and removes credentials then refreshes the list", async () => {
    render(<ProfileSection me={me} onMeUpdated={vi.fn()} passkeysEnabled />);
    await screen.findByText("MacBook");

    fireEvent.change(screen.getByLabelText("New passkey name"), { target: { value: "Phone" } });
    fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));
    expect(screen.getByRole("status", { name: "Passkey operation status" }))
      .toHaveTextContent("Follow your device or password manager prompt to create the passkey.");
    expect(screen.getByRole("status", { name: "Passkey operation status" })).not.toHaveClass("sr-only");
    await waitFor(() => expect(passkeys.add).toHaveBeenCalledWith("Phone"));
    expect(screen.getByRole("status", { name: "Passkey operation status" })).toHaveTextContent("Passkey added.");

    fireEvent.change(screen.getByLabelText("Rename MacBook"), { target: { value: "Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Save MacBook name" }));
    await waitFor(() => expect(passkeys.update).toHaveBeenCalledWith("secret-credential-id", "Laptop"));
    expect(screen.getByRole("status", { name: "Passkey operation status" })).toHaveTextContent("Passkey renamed.");

    fireEvent.click(screen.getByRole("button", { name: "Remove MacBook" }));
    await waitFor(() => expect(passkeys.remove).toHaveBeenCalledWith("secret-credential-id"));
    expect(screen.getByRole("status", { name: "Passkey operation status" })).toHaveTextContent("Passkey removed.");
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

  it("explains a cancelled creation ceremony without claiming a passkey was added", async () => {
    passkeys.add.mockRejectedValue(new Error("Auth cancelled"));
    render(<ProfileSection me={me} onMeUpdated={vi.fn()} passkeysEnabled />);
    await screen.findByText("MacBook");
    fireEvent.change(screen.getByLabelText("New passkey name"), { target: { value: "Phone" } });
    fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Passkey creation was cancelled. No passkey was added. Try again when ready.",
    );
    expect(screen.getByRole("status", { name: "Passkey operation status" })).toBeEmptyDOMElement();
    expect(screen.getByRole("status", { name: "Passkey operation status" })).toHaveClass("sr-only");
  });
});
