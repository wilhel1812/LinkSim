// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AccessSettingsEditor } from "./AccessSettingsEditor";
import type { AccessVisibility } from "./AccessSettingsEditor";
import type { AccessCollaborator } from "./AccessSettingsEditor";
import type { CollaboratorDirectoryUser } from "../lib/cloudUser";

const directory: CollaboratorDirectoryUser[] = [
  { id: "user-1", username: "Alice", email: "alice@example.com", avatarUrl: "" },
  { id: "user-2", username: "Bob", email: "bob@example.com", avatarUrl: "" },
];

const collaborators: AccessCollaborator[] = [
  { id: "user-1", username: "Alice", email: "alice@example.com", avatarUrl: "", role: "viewer" },
];

describe("AccessSettingsEditor", () => {
  it("shows the private caption by default and updates for shared visibility", async () => {
    const onVisibilityChange = vi.fn();
    function Harness() {
      const [visibility, setVisibility] = useState<AccessVisibility>("private");
      return (
        <AccessSettingsEditor
          collaborators={[]}
          directory={directory}
          onAddCollaborator={vi.fn()}
          onRemoveCollaborator={vi.fn()}
          onRoleChange={vi.fn()}
          onVisibilityChange={(next) => {
            onVisibilityChange(next);
            setVisibility(next);
          }}
          visibility={visibility}
        />
      );
    }
    render(<Harness />);

    expect(screen.getByText("Only visible to you and collaborators")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Access level"), "shared");
    expect(onVisibilityChange).toHaveBeenCalledWith("shared");
    expect(screen.getByText("Visible in the library for all users")).toBeInTheDocument();
  });

  it("uses a surface card popover and hides suggestions until search input has text", async () => {
    render(
      <AccessSettingsEditor
        collaborators={[]}
        directory={directory}
        onAddCollaborator={vi.fn()}
        onRemoveCollaborator={vi.fn()}
        onRoleChange={vi.fn()}
        onVisibilityChange={vi.fn()}
        visibility="private"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Edit collaborators" }));
    const popover = await screen.findByRole("dialog", { name: "Edit collaborators" });
    const surface = popover.closest(".ui-surface-pill");
    expect(surface).toHaveClass("ui-surface-pill");
    expect(surface).toHaveClass("is-card");
    expect(surface).toHaveClass("access-collaborator-popover");
    expect(within(popover).queryByRole("button", { name: /Add Alice/i })).not.toBeInTheDocument();

    await userEvent.type(within(popover).getByLabelText("Search users"), "ali");
    expect(await within(popover).findByRole("button", { name: /Add Alice/i })).toBeInTheDocument();
  });

  it("adds, removes, and changes roles with accessible controls", async () => {
    const onAddCollaborator = vi.fn();
    const onRemoveCollaborator = vi.fn();
    const onRoleChange = vi.fn();
    render(
      <AccessSettingsEditor
        collaborators={collaborators}
        directory={directory}
        onAddCollaborator={onAddCollaborator}
        onRemoveCollaborator={onRemoveCollaborator}
        onRoleChange={onRoleChange}
        onVisibilityChange={vi.fn()}
        visibility="private"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Edit collaborators" }));
    const popover = await screen.findByRole("dialog", { name: "Edit collaborators" });
    await userEvent.selectOptions(within(popover).getByLabelText("Role for Alice"), "editor");
    expect(onRoleChange).toHaveBeenCalledWith("user-1", "editor");

    const remove = within(popover).getByRole("button", { name: "Remove Alice" });
    expect(remove).toHaveAttribute("title", "Remove Alice");
    await userEvent.click(remove);
    expect(onRemoveCollaborator).toHaveBeenCalledWith("user-1");

    await userEvent.type(within(popover).getByLabelText("Search users"), "bob");
    await waitFor(() => expect(within(popover).getByRole("button", { name: /Add Bob/i })).toBeInTheDocument());
    await userEvent.click(within(popover).getByRole("button", { name: /Add Bob/i }));
    expect(onAddCollaborator).toHaveBeenCalledWith("user-2");
  });
});
