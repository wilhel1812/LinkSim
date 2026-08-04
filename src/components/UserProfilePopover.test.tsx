// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudUser } from "../lib/cloudUser";
import { UserProfilePopover } from "./UserProfilePopover";

const cloudUserMocks = vi.hoisted(() => ({
  fetchUserById: vi.fn(),
}));

vi.mock("../lib/cloudUser", async () => {
  const actual = await vi.importActual<typeof import("../lib/cloudUser")>("../lib/cloudUser");
  return { ...actual, fetchUserById: cloudUserMocks.fetchUserById };
});

const profile: CloudUser = {
  id: "user-1",
  username: "Ada",
  email: "ada@example.com",
  bio: "Radio planner",
  avatarUrl: "",
  isAdmin: false,
  isModerator: false,
  isApproved: true,
  role: "user",
  accountState: "approved",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: null,
};

const moderator: CloudUser = {
  ...profile,
  id: "moderator-1",
  username: "Moderator",
  isModerator: true,
  role: "moderator",
};

const makeAnchor = () => {
  const anchor = document.createElement("button");
  anchor.textContent = "Ada";
  anchor.getBoundingClientRect = () => ({
    top: 100,
    right: 160,
    bottom: 124,
    left: 120,
    width: 40,
    height: 24,
    x: 120,
    y: 100,
    toJSON: () => ({}),
  });
  document.body.appendChild(anchor);
  return anchor;
};

describe("UserProfilePopover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cloudUserMocks.fetchUserById.mockResolvedValue(profile);
  });

  it("opens beside its anchor, loads a public-safe compact profile, and closes with Escape", async () => {
    const anchor = makeAnchor();
    const onClose = vi.fn();
    render(<UserProfilePopover onClose={onClose} target={{ anchor, userId: profile.id }} />);

    expect(screen.getByRole("dialog", { name: "User profile" })).toHaveTextContent("Loading user…");
    const dialog = await screen.findByRole("dialog", { name: "User profile for Ada" });
    expect(dialog).toHaveTextContent("Ada");
    expect(dialog).toHaveTextContent("ada@example.com");
    expect(dialog).toHaveTextContent("Radio planner");
    expect(dialog).toHaveTextContent("Joined");
    expect(dialog).not.toHaveTextContent("user-1");
    expect(dialog).not.toHaveTextContent("Role");
    expect(dialog).not.toHaveTextContent("Access");

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows privileged metadata and preserves role management when enabled", async () => {
    const anchor = makeAnchor();
    const onRoleChange = vi.fn(async (_user: CloudUser, role: CloudUser["role"]) => ({
      ...profile,
      role,
      isModerator: role === "moderator",
    }));
    render(
      <UserProfilePopover
        management
        onClose={vi.fn()}
        onRoleChange={onRoleChange}
        target={{ anchor, userId: profile.id }}
        viewer={moderator}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "User profile for Ada" });
    expect(dialog).toHaveTextContent("user-1");
    expect(dialog).toHaveTextContent("Role");
    expect(dialog).toHaveTextContent("Access");

    await userEvent.selectOptions(within(dialog).getByLabelText("Role for Ada"), "pending");
    await waitFor(() => expect(onRoleChange).toHaveBeenCalledWith(profile, "pending"));
    expect(within(dialog).getByLabelText("Role for Ada")).toHaveValue("pending");
  });

  it("keeps fetch failures inside the anchored popover", async () => {
    cloudUserMocks.fetchUserById.mockRejectedValueOnce(new Error("No route"));
    const anchor = makeAnchor();
    render(<UserProfilePopover onClose={vi.fn()} target={{ anchor, userId: profile.id }} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed loading user: No route");
  });

  it("dismisses on outside interaction and focus departure", async () => {
    const anchor = makeAnchor();
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.appendChild(outside);
    const onClose = vi.fn();
    const view = render(<UserProfilePopover onClose={onClose} target={{ anchor, userId: profile.id }} />);
    await screen.findByRole("dialog", { name: "User profile for Ada" });

    fireEvent.mouseDown(outside);
    expect(onClose).toHaveBeenCalledTimes(1);

    view.rerender(<UserProfilePopover onClose={onClose} target={{ anchor, userId: profile.id }} />);
    onClose.mockClear();
    outside.focus();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
