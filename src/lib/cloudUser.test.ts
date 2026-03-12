import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchMe,
  fetchUsers,
  fetchResourceChanges,
  fetchAdminAuditEvents,
  updateUserRole,
} from "./cloudUser";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("cloudUser client", () => {
  it("fetchMe returns user payload", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ user: { id: "u1", username: "U", bio: "", avatarUrl: "", isAdmin: false, isApproved: true, createdAt: "x", updatedAt: "x" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await fetchMe();
    expect(result.id).toBe("u1");
  });

  it("normalizes non-array users and changes payloads", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ users: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ changes: null }), { status: 200 }));

    await expect(fetchUsers()).resolves.toEqual([]);
    await expect(fetchResourceChanges("site", "s1")).resolves.toEqual([]);
  });

  it("fetchAdminAuditEvents defaults to empty list when payload shape is unexpected", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ events: {} }), { status: 200 }));
    await expect(fetchAdminAuditEvents()).resolves.toEqual([]);
  });

  it("surfaces parsed JSON error messages", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid role." }), { status: 400, statusText: "Bad Request" }),
    );

    await expect(updateUserRole("u1", "admin")).rejects.toThrow("400 Bad Request: Invalid role.");
  });
});
