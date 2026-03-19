import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNotifications } from "./cloudNotifications";

describe("fetchNotifications", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes credentials on notifications fetch", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ unreadCount: 0, items: [] }), { status: 200 }));

    await fetchNotifications();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/notifications");
    expect(options).toMatchObject({
      method: "GET",
      credentials: "include",
    });
  });

  it("normalizes malformed payloads", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ unreadCount: "bad", items: "nope" }), { status: 200 }),
    );

    const feed = await fetchNotifications();

    expect(feed).toEqual({ unreadCount: 0, items: [] });
  });
});
