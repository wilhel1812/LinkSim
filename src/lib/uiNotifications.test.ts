import { describe, expect, it } from "vitest";
import {
  clearUiNotifications,
  createUiNotification,
  dismissUiNotification,
  upsertUiNotification,
} from "./uiNotifications";

describe("createUiNotification", () => {
  it("applies defaults", () => {
    expect(
      createUiNotification(
        {
          id: "alpha",
          message: "Saved",
        },
        100,
      ),
    ).toMatchObject({
      id: "alpha",
      message: "Saved",
      tone: "info",
      dismissMode: "auto",
      durationMs: 5000,
      createdAt: 100,
      pinned: false,
    });
  });

  it("forces manual dismiss mode for pinned notifications", () => {
    expect(createUiNotification({ id: "auth", message: "Auth warning", pinned: true }).dismissMode).toBe("manual");
  });
});

describe("upsertUiNotification", () => {
  it("adds notifications when id does not exist", () => {
    const next = upsertUiNotification([], { id: "alpha", message: "Saved" }, 100);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: "alpha", createdAt: 100 });
  });

  it("replaces notifications with the same id", () => {
    const initial = upsertUiNotification([], { id: "alpha", message: "Saved" }, 100);
    const next = upsertUiNotification(initial, { id: "alpha", message: "Updated", tone: "warning" }, 200);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: "alpha", message: "Updated", tone: "warning", createdAt: 200 });
  });
});

describe("dismissUiNotification", () => {
  it("removes only the selected notification", () => {
    const seeded = [
      createUiNotification({ id: "alpha", message: "A" }, 100),
      createUiNotification({ id: "beta", message: "B" }, 200),
    ];
    const next = dismissUiNotification(seeded, "alpha");
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("beta");
  });

  it("keeps pinned notifications unless forced", () => {
    const seeded = [createUiNotification({ id: "auth", message: "Auth warning", pinned: true }, 100)];
    expect(dismissUiNotification(seeded, "auth").map((item) => item.id)).toEqual(["auth"]);
    expect(dismissUiNotification(seeded, "auth", { force: true })).toEqual([]);
  });
});

describe("clearUiNotifications", () => {
  it("preserves pinned notifications unless forced", () => {
    const seeded = [
      createUiNotification({ id: "auth", message: "Auth warning", pinned: true }, 100),
      createUiNotification({ id: "saved", message: "Saved" }, 200),
    ];
    expect(clearUiNotifications(seeded).map((item) => item.id)).toEqual(["auth"]);
    expect(clearUiNotifications(seeded, { force: true })).toEqual([]);
  });
});
