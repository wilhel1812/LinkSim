import { beforeEach, describe, expect, it, vi } from "vitest";

const { readPublicSiteNoticeMock } = vi.hoisted(() => ({
  readPublicSiteNoticeMock: vi.fn(),
}));

vi.mock("./_lib/siteNotice", () => ({ readPublicSiteNotice: readPublicSiteNoticeMock }));

import { onRequestGet } from "./site-status.json";

const env = { DB: {} } as unknown as Parameters<typeof onRequestGet>[0]["env"];

beforeEach(() => {
  vi.clearAllMocks();
  readPublicSiteNoticeMock.mockResolvedValue(null);
});

describe("public site status", () => {
  it("returns only the active public notice with bounded caching", async () => {
    readPublicSiteNoticeMock.mockResolvedValue({
      tone: "warning",
      message: "Registration is temporarily closed.",
      dismissible: false,
      revision: 4,
      updatedAt: "2026-08-20T10:00:00.000Z",
      expiresAt: null,
    });
    const response = await onRequestGet({
      request: new Request("https://linksim.link/site-status.json"),
      env,
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=30, s-maxage=30, stale-while-revalidate=60");
    expect(response.headers.get("etag")).toBe('"site-notice-4"');
    await expect(response.json()).resolves.toEqual({
      notice: {
        tone: "warning",
        message: "Registration is temporarily closed.",
        dismissible: false,
        revision: 4,
        updatedAt: "2026-08-20T10:00:00.000Z",
        expiresAt: null,
      },
    });
  });

  it("fails open with no notice when D1 is unavailable", async () => {
    readPublicSiteNoticeMock.mockRejectedValue(new Error("D1 unavailable"));
    const response = await onRequestGet({
      request: new Request("https://linksim.link/site-status.json"),
      env,
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ notice: null });
  });
});
