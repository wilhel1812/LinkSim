import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearMeCache,
  fetchMe,
  fetchUsers,
  fetchResourceChanges,
  fetchAdminAuditEvents,
  updateUserRole,
  updateMyProfile,
} from "./cloudUser";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  clearMeCache();
});

afterEach(() => {
  clearMeCache();
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
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    const headers = new Headers((init as RequestInit | undefined)?.headers ?? {});
    expect(headers.has("content-type")).toBe(false);
  });

  it("sends JSON content-type when request has body", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ user: { id: "u1", username: "U", bio: "", avatarUrl: "", isAdmin: false, isApproved: true, createdAt: "x", updatedAt: "x" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await updateMyProfile({ bio: "hello" });
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    const headers = new Headers((init as RequestInit | undefined)?.headers ?? {});
    expect(headers.get("content-type")).toBe("application/json");
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

  describe("fetchMe cache", () => {
    const userPayload = {
      id: "u1",
      username: "U",
      bio: "",
      avatarUrl: "",
      isAdmin: false,
      isApproved: true,
      createdAt: "x",
      updatedAt: "x",
    };

    it("caches fetchMe result for subsequent calls within TTL", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ user: userPayload }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const first = await fetchMe();
      expect(first.id).toBe("u1");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      const second = await fetchMe();
      expect(second.id).toBe("u1");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("clearMeCache forces a fresh fetch", async () => {
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ user: userPayload }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ user: { ...userPayload, id: "u2" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      const first = await fetchMe();
      expect(first.id).toBe("u1");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      clearMeCache();

      const second = await fetchMe();
      expect(second.id).toBe("u2");
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
