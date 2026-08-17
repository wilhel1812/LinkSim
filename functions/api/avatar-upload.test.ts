import { beforeEach, describe, expect, it, vi } from "vitest";
import { AVATAR_REQUEST_MAX_BYTES } from "../../src/lib/avatarLimits";

const { verifyAuthMock, ensureUserMock, fetchUserProfileMock, getUserAvatarKeysMock, setUserAvatarAssetsMock } = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(), ensureUserMock: vi.fn(), fetchUserProfileMock: vi.fn(),
  getUserAvatarKeysMock: vi.fn(), setUserAvatarAssetsMock: vi.fn(),
}));
vi.mock("../_lib/auth", () => ({ verifyAuth: verifyAuthMock }));
vi.mock("../_lib/db", () => ({
  ensureUser: ensureUserMock, fetchUserProfile: fetchUserProfileMock,
  getUserAvatarKeys: getUserAvatarKeysMock, setUserAvatarAssets: setUserAvatarAssetsMock,
}));

import { onRequestPost } from "./avatar-upload";

const pngDataUrl = (size = 8) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return `data:image/png;base64,${btoa(binary)}`;
};

const makeEnv = (overrides: Record<string, unknown> = {}) => ({
  DB: {}, AVATAR_BUCKET: { put: vi.fn(), delete: vi.fn() }, ...overrides,
} as unknown as Parameters<typeof onRequestPost>[0]["env"]);
const call = (env: Parameters<typeof onRequestPost>[0]["env"], body: string) => onRequestPost({
  request: new Request("https://example.test/api/avatar-upload", {
    method: "POST", headers: { "content-type": "application/json" }, body,
  }),
  env,
} as never);

describe("avatar upload bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAuthMock.mockResolvedValue({ userId: "hidden@example.com", tokenPayload: {}, source: "headers" });
    fetchUserProfileMock.mockResolvedValue({ id: "hidden@example.com" });
    getUserAvatarKeysMock.mockResolvedValue({ avatarObjectKey: null, avatarThumbKey: null });
    setUserAvatarAssetsMock.mockImplementation(async (_env, _id, avatar) => ({ id: "hidden@example.com", ...avatar }));
  });

  it("accepts exactly 8,000,090 UTF-8 bytes at depth 1 and rejects +1 or depth 2", async () => {
    const image = pngDataUrl();
    const base = JSON.stringify({ originalDataUrl: image, thumbDataUrl: image, padding: "" });
    const exact = base.replace('""}', `"${"x".repeat(AVATAR_REQUEST_MAX_BYTES - new TextEncoder().encode(base).byteLength)}"}`);
    expect(new TextEncoder().encode(exact)).toHaveLength(AVATAR_REQUEST_MAX_BYTES);
    expect((await call(makeEnv(), exact)).status).toBe(200);
    expect((await call(makeEnv(), `${exact} `)).status).toBe(413);
    expect((await call(makeEnv(), JSON.stringify({ originalDataUrl: image, thumbDataUrl: image, extra: { nested: true } }))).status).toBe(422);
  });

  it("accepts exact decoded limits and rejects the next byte or MIME/magic mismatch", async () => {
    expect((await call(makeEnv(), JSON.stringify({ originalDataUrl: pngDataUrl(5_000_000), thumbDataUrl: pngDataUrl(1_000_000) }))).status).toBe(200);
    expect((await call(makeEnv(), JSON.stringify({ originalDataUrl: pngDataUrl(5_000_001), thumbDataUrl: pngDataUrl() }))).status).toBe(413);
    expect((await call(makeEnv(), JSON.stringify({ originalDataUrl: pngDataUrl(), thumbDataUrl: pngDataUrl(1_000_001) }))).status).toBe(413);
    const mismatch = `data:image/jpeg;base64,${pngDataUrl().split(",")[1]}`;
    expect((await call(makeEnv(), JSON.stringify({ originalDataUrl: mismatch, thumbDataUrl: pngDataUrl() }))).status).toBe(400);
  });

  it("uses opaque keys without disclosing the user identity", async () => {
    const puts: string[] = [];
    const env = makeEnv({ AVATAR_BUCKET: { put: vi.fn(async (key: string) => { puts.push(key); }), delete: vi.fn() } });
    const image = pngDataUrl();
    const response = await call(env, JSON.stringify({ originalDataUrl: image, thumbDataUrl: image }));
    expect(response.status).toBe(200);
    expect(puts).toHaveLength(2);
    expect(puts.join(" ")).not.toContain("hidden@example.com");
    expect(JSON.stringify(await response.json())).not.toContain("hidden%40example.com");
  });

  it("cleans only newly written objects when storage or profile update fails", async () => {
    getUserAvatarKeysMock.mockResolvedValue({ avatarObjectKey: "users/prior/full.webp", avatarThumbKey: "users/prior/thumb.webp" });
    const deleteMock = vi.fn();
    let env = makeEnv({ AVATAR_BUCKET: { put: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("thumb failed")), delete: deleteMock } });
    expect((await call(env, JSON.stringify({ originalDataUrl: pngDataUrl(), thumbDataUrl: pngDataUrl() }))).status).toBe(500);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).not.toHaveBeenCalledWith(expect.stringContaining("prior"));

    vi.clearAllMocks();
    getUserAvatarKeysMock.mockResolvedValue({ avatarObjectKey: "users/prior/full.webp", avatarThumbKey: "users/prior/thumb.webp" });
    setUserAvatarAssetsMock.mockRejectedValueOnce(new Error("db failed"));
    const deletes = vi.fn();
    env = makeEnv({ AVATAR_BUCKET: { put: vi.fn(), delete: deletes } });
    expect((await call(env, JSON.stringify({ originalDataUrl: pngDataUrl(), thumbDataUrl: pngDataUrl() }))).status).toBe(500);
    expect(deletes).toHaveBeenCalledTimes(2);
    expect(deletes).not.toHaveBeenCalledWith(expect.stringContaining("prior"));
  });
});
