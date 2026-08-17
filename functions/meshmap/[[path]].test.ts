import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClientAddressMock, takeRateLimitTokenMock } = vi.hoisted(() => ({
  getClientAddressMock: vi.fn(),
  takeRateLimitTokenMock: vi.fn(),
}));

vi.mock("../_lib/rateLimit", () => ({
  getClientAddress: getClientAddressMock,
  parsePerMinuteLimit: (raw: string | undefined, fallback: number, blankFallback = fallback) =>
    raw === undefined || raw.trim() === "" ? blankFallback : Number(raw),
  takeRateLimitToken: takeRateLimitTokenMock,
}));

import { onRequest } from "./[[path]]";

const env = { DB: {}, PROXY_RATE_LIMIT_PER_MINUTE: "120" } as unknown as {
  DB: D1Database;
  PROXY_RATE_LIMIT_PER_MINUTE?: string;
};

const mkCtx = (request: Request, routeEnv = env) => ({ request, env: routeEnv } as unknown as Parameters<typeof onRequest>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  getClientAddressMock.mockReturnValue("198.51.100.10");
  takeRateLimitTokenMock.mockReturnValue({ allowed: true, remaining: 119, retryAfterSec: 0 });
  vi.stubGlobal("fetch", vi.fn());
});

describe("meshmap proxy", () => {
  it.each([
    [undefined, 1],
    ["", 1],
    ["   ", 1],
    ["17", 17],
  ])("preserves the deployed proxy limit for configured value %s", async (configured, expected) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response("{}", {
      headers: { "content-type": "application/json" },
    }));
    await onRequest(mkCtx(
      new Request("https://example.test/meshmap/nodes.json"),
      { DB: {}, PROXY_RATE_LIMIT_PER_MINUTE: configured } as unknown as typeof env,
    ));

    expect(takeRateLimitTokenMock).toHaveBeenCalledWith({
      key: "proxy:meshmap:198.51.100.10",
      limit: expected,
    });
  });

  it("rejects methods other than GET/HEAD", async () => {
    const req = new Request("https://example.test/meshmap/nodes.json", { method: "POST", body: "{}" });
    const res = await onRequest(mkCtx(req));

    expect(res.status).toBe(405);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(takeRateLimitTokenMock).not.toHaveBeenCalled();
  });

  it.each([
    "https://example.test/meshmap",
    "https://example.test/meshmap/",
    "https://example.test/meshmap/index.html",
    "https://example.test/meshmap/nodes.json/extra",
  ])("rejects disallowed path %s", async (url) => {
    const res = await onRequest(mkCtx(new Request(url)));

    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(takeRateLimitTokenMock).not.toHaveBeenCalled();
  });

  it("rejects every query parameter", async () => {
    const res = await onRequest(mkCtx(new Request("https://example.test/meshmap/nodes.json?region=no")));

    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(takeRateLimitTokenMock).not.toHaveBeenCalled();
  });

  it("returns diagnostic headers when the proxy limiter blocks the request", async () => {
    takeRateLimitTokenMock.mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterSec: 9 });
    const res = await onRequest(mkCtx(new Request("https://example.test/meshmap/nodes.json")));

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("9");
    expect(res.headers.get("x-rate-limit-source")).toBe("proxy");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("forwards only the fixed passive request contract", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    );
    const req = new Request("https://example.test/meshmap/nodes.json", {
      headers: {
        accept: "text/html",
        authorization: "Bearer secret",
        cookie: "session=secret",
        "cf-access-authenticated-user-email": "user@example.test",
        "cf-access-authenticated-user-id": "user-id",
        "cf-access-authenticated-user-name": "User Name",
        "cf-access-jwt-assertion": "secret-jwt",
        "x-forwarded-for": "203.0.113.99",
      },
    });

    const res = await onRequest(mkCtx(req));

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith("https://meshmap.net/nodes.json", {
      method: "GET",
      headers: { accept: "application/json" },
    });
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="nodes.json"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("public, max-age=1800");
  });

  it("does not relay sensitive upstream response headers", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "upstream=secret",
          authorization: "Bearer upstream",
          "cf-access-authenticated-user-email": "upstream@example.test",
          "cf-access-authenticated-user-id": "upstream-id",
          "cf-access-authenticated-user-name": "Upstream Name",
          "cf-access-jwt-assertion": "upstream-jwt",
          "x-forwarded-for": "192.0.2.1",
        },
      }),
    );

    const res = await onRequest(mkCtx(new Request("https://example.test/meshmap/nodes.json")));

    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("authorization")).toBeNull();
    expect(res.headers.get("cf-access-authenticated-user-email")).toBeNull();
    expect(res.headers.get("cf-access-authenticated-user-id")).toBeNull();
    expect(res.headers.get("cf-access-authenticated-user-name")).toBeNull();
    expect(res.headers.get("cf-access-jwt-assertion")).toBeNull();
    expect(res.headers.get("x-forwarded-for")).toBeNull();
  });

  it.each(["text/html", "application/javascript", null])(
    "rejects active or missing upstream content type %s",
    async (contentType) => {
      const headers = contentType ? { "content-type": contentType } : undefined;
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("<script>alert(1)</script>", { status: 200, headers }),
      );

      const res = await onRequest(mkCtx(new Request("https://example.test/meshmap/nodes.json")));

      expect(res.status).toBe(502);
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="nodes.txt"');
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).not.toContain("<script>");
    },
  );

  it("labels upstream throttling without relaying its response body or credentials", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("<html>upstream throttle</html>", {
        status: 429,
        headers: { "retry-after": "7", "content-type": "text/html", "set-cookie": "bad=1" },
      }),
    );

    const res = await onRequest(mkCtx(new Request("https://example.test/meshmap/nodes.json")));

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(res.headers.get("x-rate-limit-source")).toBe("upstream");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).not.toContain("<html>");
  });

  it("supports HEAD without returning a body", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(null, { status: 200, headers: { "content-type": "application/json" } }),
    );

    const res = await onRequest(mkCtx(new Request("https://example.test/meshmap/nodes.json", { method: "HEAD" })));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(globalThis.fetch).toHaveBeenCalledWith("https://meshmap.net/nodes.json", {
      method: "HEAD",
      headers: { accept: "application/json" },
    });
  });

  it("accepts exact node and byte boundaries and rejects overflow", async () => {
    const exactNodes = Object.fromEntries(Array.from({ length: 20_000 }, (_, index) => [`!${index}`, { lat: 60, lon: 10 }]));
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify(exactNodes), { headers: { "content-type": "application/json" } }));
    expect((await onRequest(mkCtx(new Request("https://example.test/meshmap/nodes.json")))).status).toBe(200);

    const tooMany = { ...exactNodes, "!overflow": { lat: 60, lon: 10 } };
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify(tooMany), { headers: { "content-type": "application/json" } }));
    expect((await onRequest(mkCtx(new Request("https://example.test/meshmap/nodes.json")))).status).toBe(502);

    const exactBytes = `[]${" ".repeat(5 * 1024 * 1024 - 2)}`;
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(exactBytes, { headers: { "content-type": "application/json" } }));
    expect((await onRequest(mkCtx(new Request("https://example.test/meshmap/nodes.json")))).status).toBe(200);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { "content-type": "application/json" } }));
    expect((await onRequest(mkCtx(new Request("https://example.test/meshmap/nodes.json")))).status).toBe(502);
  });

  it.each(["null", "42", '"nodes"'])("rejects primitive JSON root %s", async (body) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(body, { headers: { "content-type": "application/json" } }));

    const response = await onRequest(mkCtx(new Request("https://example.test/meshmap/nodes.json")));

    expect(response.status).toBe(502);
    expect(await response.text()).toContain("invalid or oversized node feed");
  });
});
