import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearMeCache,
  fetchAuthStatus,
  fetchMe,
  fetchUsers,
  mergeCloudUserProfilePatch,
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

  it("reads auth state from the existing public simulation boundary", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: false, authState: "guest" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(fetchAuthStatus()).resolves.toEqual({ authenticated: false, authState: "guest" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/public-simulation?mode=auth",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("preserves username setup state from fetchMe", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ user: { id: "u1", username: "", needsUsername: true, bio: "", avatarUrl: "", isAdmin: false, isApproved: true, createdAt: "x", updatedAt: "x" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(fetchMe()).resolves.toMatchObject({ id: "u1", needsUsername: true, username: "" });
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

  it("merges only patched response fields and keeps the newest timestamp", () => {
    const current = {
      id: "u1", username: "", needsUsername: true, bio: "", avatarUrl: "", isAdmin: false, isApproved: true,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z",
      defaultFrequencyPresetId: "new-radio",
    };
    const staleResponse = {
      ...current,
      username: "Owner",
      needsUsername: false,
      defaultFrequencyPresetId: "old-radio",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };

    expect(mergeCloudUserProfilePatch(current, staleResponse, { username: "Owner" })).toMatchObject({
      username: "Owner",
      needsUsername: false,
      defaultFrequencyPresetId: "new-radio",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
  });

  it("serializes same-field requests and keeps submission order despite inverted timestamps", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    vi.mocked(globalThis.fetch).mockImplementation(() => new Promise<Response>((resolve) => resolvers.push(resolve)));
    const base = {
      id: "u1", username: "Alice", bio: "", avatarUrl: "", isAdmin: false, isApproved: true,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const bobRequest = updateMyProfile({ username: "Bob" });
    const carolRequest = updateMyProfile({ username: "Carol" });
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));
    resolvers[0]?.(new Response(JSON.stringify({ user: { ...base, username: "Bob", updatedAt: "2026-01-03T00:00:00.000Z" } }), { status: 200 }));
    const bob = await bobRequest;
    let current = mergeCloudUserProfilePatch(base, bob, { username: "Bob" });
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[1]?.(new Response(JSON.stringify({ user: { ...base, username: "Carol", updatedAt: "2026-01-02T00:00:00.000Z" } }), { status: 200 }));
    const carol = await carolRequest;
    current = mergeCloudUserProfilePatch(current, carol, { username: "Carol" });

    expect(current).toMatchObject({ username: "Carol", updatedAt: "2026-01-03T00:00:00.000Z" });
  });

  it("accepts an older successful response when the newer same-field request fails", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    vi.mocked(globalThis.fetch).mockImplementation(() => new Promise<Response>((resolve) => resolvers.push(resolve)));
    const base = {
      id: "u1", username: "Alice", bio: "", avatarUrl: "", isAdmin: false, isApproved: true,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const bobRequest = updateMyProfile({ username: "Bob" });
    const carolRequest = updateMyProfile({ username: "Carol" });
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));
    resolvers[0]?.(new Response(JSON.stringify({ user: { ...base, username: "Bob", updatedAt: "2026-01-02T00:00:00.000Z" } }), { status: 200 }));
    const bob = await bobRequest;
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[1]?.(new Response(JSON.stringify({ error: "Username save failed." }), { status: 500, statusText: "Internal Server Error" }));
    await expect(carolRequest).rejects.toThrow("Username save failed.");

    expect(mergeCloudUserProfilePatch(base, bob, { username: "Bob" })).toMatchObject({
      username: "Bob",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
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
