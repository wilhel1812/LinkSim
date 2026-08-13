import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("avatar upload privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAuthMock.mockResolvedValue({ userId: "hidden@example.com", tokenPayload: {}, source: "headers" });
    fetchUserProfileMock.mockResolvedValue({ id: "hidden@example.com" });
    getUserAvatarKeysMock.mockResolvedValue({ avatarObjectKey: null, avatarThumbKey: null });
    setUserAvatarAssetsMock.mockImplementation(async (_env, _id, avatar) => ({ id: "hidden@example.com", ...avatar }));
  });

  it("uses opaque keys and URLs that do not disclose an email-shaped user ID", async () => {
    const puts: string[] = [];
    const env = {
      DB: {},
      AVATAR_BUCKET: { put: vi.fn(async (key: string) => { puts.push(key); }), delete: vi.fn() },
    } as unknown as Parameters<typeof onRequestPost>[0]["env"];
    const image = `data:image/png;base64,${btoa("png")}`;
    const response = await onRequestPost({
      request: new Request("https://example.test/api/avatar-upload", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ originalDataUrl: image, thumbDataUrl: image }),
      }),
      env,
    } as never);

    expect(response.status).toBe(200);
    expect(puts).toHaveLength(2);
    expect(puts.join(" ")).not.toContain("hidden@example.com");
    expect(JSON.stringify(await response.json())).not.toContain("hidden%40example.com");
  });
});
