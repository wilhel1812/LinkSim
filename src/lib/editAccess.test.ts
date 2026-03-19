import { describe, expect, it } from "vitest";
import {
  getMutationPermissionMessage,
  canMutateActiveSimulation,
  countNonEditableResourceIds,
  type EditableResource,
} from "./editAccess";

const user = { id: "user-1" };

describe("canMutateActiveSimulation", () => {
  const presets: EditableResource[] = [
    { id: "sim-owner", ownerUserId: "user-1", effectiveRole: "viewer" },
    { id: "sim-editor", ownerUserId: "owner-2", effectiveRole: "editor" },
    { id: "sim-viewer", ownerUserId: "owner-3", effectiveRole: "viewer" },
  ];

  it("returns true for builtin simulations", () => {
    expect(canMutateActiveSimulation("builtin:starter", presets, user)).toBe(true);
  });

  it("returns true when user can edit saved simulation", () => {
    expect(canMutateActiveSimulation("saved:sim-owner", presets, user)).toBe(true);
    expect(canMutateActiveSimulation("saved:sim-editor", presets, user)).toBe(true);
  });

  it("returns false for saved simulations without edit access", () => {
    expect(canMutateActiveSimulation("saved:sim-viewer", presets, user)).toBe(false);
  });

  it("returns false without current user", () => {
    expect(canMutateActiveSimulation("saved:sim-owner", presets, null)).toBe(false);
  });
});

describe("countNonEditableResourceIds", () => {
  const entries: EditableResource[] = [
    { id: "site-owner", ownerUserId: "user-1", effectiveRole: "viewer" },
    { id: "site-editor", ownerUserId: "owner-2", effectiveRole: "editor" },
    { id: "site-viewer", ownerUserId: "owner-3", effectiveRole: "viewer" },
  ];

  it("counts only selected resources that cannot be edited", () => {
    const selected = new Set(["site-owner", "site-editor", "site-viewer", "missing"]);
    expect(countNonEditableResourceIds(selected, entries, user)).toBe(1);
  });

  it("counts selected resources as non-editable when user is signed out", () => {
    const selected = new Set(["site-owner", "site-editor"]);
    expect(countNonEditableResourceIds(selected, entries, null)).toBe(2);
  });
});

describe("getMutationPermissionMessage", () => {
  it("returns consistent read-only messages", () => {
    expect(getMutationPermissionMessage("link", "create")).toBe(
      "Cannot create link: you do not have edit access to this simulation.",
    );
    expect(getMutationPermissionMessage("site", "remove")).toBe(
      "Cannot remove site: you do not have edit access to this simulation.",
    );
    expect(getMutationPermissionMessage("library-site", "delete")).toBe(
      "Cannot delete site: you do not have edit access to one or more selected Site Library entries.",
    );
  });
});
