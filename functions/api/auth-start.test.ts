import { describe, expect, it } from "vitest";
import { onRequestGet } from "./auth-start";

const mkCtx = (request: Request) => ({ request } as Parameters<typeof onRequestGet>[0]);

describe("api/auth-start", () => {
  it("redirects to same-origin returnTo path", async () => {
    const req = new Request("https://example.test/api/auth-start?returnTo=%2Ffoo%3Fbar%3D1%23baz");
    const res = await onRequestGet(mkCtx(req));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.test/foo?bar=1#baz");
  });

  it("falls back to root for invalid returnTo", async () => {
    const req = new Request("https://example.test/api/auth-start?returnTo=https%3A%2F%2Fevil.test%2Fpwnd");
    const res = await onRequestGet(mkCtx(req));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.test/");
  });
});
