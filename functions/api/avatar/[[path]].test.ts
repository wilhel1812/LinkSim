import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./[[path]]";

const key = "users/123e4567-e89b-12d3-a456-426614174000/avatar-0123456789abcdef.webp";
const thumbKey = "users/123e4567-e89b-12d3-a456-426614174000/avatar-0123456789abcdef-thumb.webp";
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngBytes = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set(png);
  return bytes;
};
const object = (bytes = png, contentType = "image/png") => ({
  body: new Response(bytes).body,
  httpEtag: '"etag"',
  writeHttpMetadata: (headers: Headers) => headers.set("content-type", contentType),
});
const request = (path = key) => new Request(`https://example.test/api/avatar/${path}`);
const context = (bucket: { get: ReturnType<typeof vi.fn> }, extra = {}) => ({
  request: request(),
  env: { DB: {}, AVATAR_BUCKET: bucket, ...extra },
} as never);

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

describe("avatar delivery", () => {
  it("validates keys before storage access", async () => {
    const get = vi.fn();
    for (const invalid of ["../secret", `${key}%2fextra`, `${key}%252fextra`, `${key}\\extra`, "%zz"]) {
      const response = await onRequestGet({ ...context({ get }), request: request(invalid) });
      expect(response.status).toBe(400);
    }
    expect(get).not.toHaveBeenCalled();
  });

  it("bounds and validates stored avatar bytes", async () => {
    const get = vi.fn().mockResolvedValue(object(pngBytes(5_000_000)));
    const response = await onRequestGet(context({ get }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.arrayBuffer()).resolves.toHaveProperty("byteLength", 5_000_000);

    get.mockResolvedValueOnce(object(new Uint8Array(5_000_001)));
    expect((await onRequestGet(context({ get }))).status).toBe(502);
    get.mockResolvedValueOnce(object(pngBytes(1_000_000)));
    expect((await onRequestGet({ ...context({ get }), request: request(thumbKey) })).status).toBe(200);
    get.mockResolvedValueOnce(object(pngBytes(1_000_001)));
    expect((await onRequestGet({ ...context({ get }), request: request(thumbKey) })).status).toBe(502);
    get.mockResolvedValueOnce(object(Uint8Array.from([0xff, 0xd8, 0xff]), "image/png"));
    expect((await onRequestGet(context({ get }))).status).toBe(502);
  });

  it("rejects recursive or redirecting fallback and strips upstream headers", async () => {
    const get = vi.fn().mockResolvedValue(null);
    expect((await onRequestGet(context({ get }, { AVATAR_FALLBACK_ORIGIN: "https://example.test" }))).status).toBe(404);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://evil.test" } }));
    expect((await onRequestGet(context({ get }, { AVATAR_FALLBACK_ORIGIN: "https://fallback.test" }))).status).toBe(404);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(png, { headers: { "content-type": "image/png", "set-cookie": "secret=1", "x-secret": "x" } }));
    const response = await onRequestGet(context({ get }, { AVATAR_FALLBACK_ORIGIN: "https://fallback.test" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-secret")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(globalThis.fetch).toHaveBeenLastCalledWith(expect.stringContaining("fallback.test/api/avatar/"), expect.objectContaining({ redirect: "manual" }));

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(pngBytes(1_000_000), { headers: { "content-type": "image/png" } }));
    expect((await onRequestGet({ ...context({ get }, { AVATAR_FALLBACK_ORIGIN: "https://fallback.test" }), request: request(thumbKey) })).status).toBe(200);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(pngBytes(1_000_001), { headers: { "content-type": "image/png" } }));
    expect((await onRequestGet({ ...context({ get }, { AVATAR_FALLBACK_ORIGIN: "https://fallback.test" }), request: request(thumbKey) })).status).toBe(404);
  });
});
