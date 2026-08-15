import { describe, expect, it } from "vitest";
import {
  AVATAR_FULL_MAX_BYTES,
  AVATAR_OBJECT_KEY_MAX_CHARS,
  avatarUrlForObjectKey,
  parseAvatarDataUrl,
  parseAvatarObjectKey,
  thumbnailAvatarUrl,
} from "./avatarLimits";

const dataUrl = (type: string, bytes: number[]) => {
  const binary = String.fromCharCode(...bytes);
  return `data:${type};base64,${btoa(binary)}`;
};

describe("avatar limits", () => {
  it("accepts matching PNG, JPEG, and WebP magic and strict base64", () => {
    expect(parseAvatarDataUrl(dataUrl("image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), AVATAR_FULL_MAX_BYTES).contentType).toBe("image/png");
    expect(parseAvatarDataUrl(dataUrl("image/jpeg", [0xff, 0xd8, 0xff, 0xe0]), AVATAR_FULL_MAX_BYTES).contentType).toBe("image/jpeg");
    expect(parseAvatarDataUrl(dataUrl("image/webp", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), AVATAR_FULL_MAX_BYTES).contentType).toBe("image/webp");
    expect(() => parseAvatarDataUrl("data:image/png;base64,iVBORw0KGgo", AVATAR_FULL_MAX_BYTES)).toThrow("base64");
    expect(() => parseAvatarDataUrl(dataUrl("image/png", [0xff, 0xd8, 0xff]), AVATAR_FULL_MAX_BYTES)).toThrow("does not match");
  });

  it("accepts current and legacy opaque keys while rejecting path tricks", () => {
    const owner = "123e4567-e89b-12d3-a456-426614174000";
    const current = `users/${owner}/avatar-0123456789abcdef.webp`;
    const legacy = `users/${owner}/avatar-1712345678901-0123456789abcdef-thumb.webp`;
    expect(parseAvatarObjectKey(current)).toBe(current);
    expect(parseAvatarObjectKey(legacy)).toBe(legacy);
    expect(legacy).toHaveLength(AVATAR_OBJECT_KEY_MAX_CHARS);
    for (const invalid of [
      `admins/${owner}/avatar-0123456789abcdef.webp`,
      `users/${owner}/../avatar-0123456789abcdef.webp`,
      `users/${owner}\\avatar-0123456789abcdef.webp`,
      `users/${owner}/avatar-0123456789abcdef.webp%252fextra`,
      `users/${owner}/avatar-0123456789abcdef.webp%2fextra`,
      `users/${owner}/avatar-0123456789abcdef.gif`,
    ]) expect(() => parseAvatarObjectKey(invalid)).toThrow("key");
  });

  it("uses encoded internal segments and preserves external full-image URLs", () => {
    const key = "users/123e4567-e89b-12d3-a456-426614174000/avatar-0123456789abcdef-thumb.webp";
    expect(avatarUrlForObjectKey(key)).toBe(`/api/avatar/${key}`);
    expect(avatarUrlForObjectKey(key, "https://cdn.example.test/")).toBe(`https://cdn.example.test/${encodeURIComponent(key)}`);
    expect(() => avatarUrlForObjectKey(key, "javascript:alert(1)")).toThrow("URL");
    expect(() => avatarUrlForObjectKey(key, "https://secret@cdn.example.test")).toThrow("URL");
    expect(thumbnailAvatarUrl("/api/avatar/full", key)).toBe(`/api/avatar/${key}`);
    expect(thumbnailAvatarUrl("https://external.test/full.png", key)).toBe("https://external.test/full.png");
    expect(thumbnailAvatarUrl("/api/avatar/full", "bad-key")).toBe("/api/avatar/full");
  });
});
