import { verifyAuth } from "../_lib/auth";
import { ensureUser, fetchUserProfile, getUserAvatarKeys, setUserAvatarAssets } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

const SUPPORTED_CONTENT_TYPES = new Set(["image/webp", "image/png", "image/jpeg"]);

type ParsedDataUrl = {
  contentType: string;
  bytes: Uint8Array;
};

const parseDataUrl = (value: unknown): ParsedDataUrl => {
  if (typeof value !== "string") throw new Error("Image payload must be a data URL.");
  const trimmed = value.trim();
  const match = /^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(trimmed);
  if (!match) throw new Error("Unsupported image format. Use webp, png, or jpeg.");
  const contentType = match[1].toLowerCase();
  if (!SUPPORTED_CONTENT_TYPES.has(contentType)) throw new Error("Unsupported image type.");
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { contentType, bytes };
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const extForType = (contentType: string): string => {
  if (contentType === "image/png") return "png";
  if (contentType === "image/jpeg") return "jpg";
  return "webp";
};

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    if (!env.AVATAR_BUCKET) {
      return withCors(request, json({ error: "Avatar storage bucket not configured." }, { status: 503 }));
    }

    await ensureUser(env, auth.userId, auth.tokenPayload);
    const me = await fetchUserProfile(env, auth.userId);
    if (!me) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    const body = (await request.json()) as {
      originalDataUrl?: unknown;
      thumbDataUrl?: unknown;
    };

    const original = parseDataUrl(body.originalDataUrl);
    const thumb = parseDataUrl(body.thumbDataUrl);

    if (original.bytes.byteLength > 600_000) throw new Error("Avatar image too large.");
    if (thumb.bytes.byteLength > 200_000) throw new Error("Avatar thumbnail too large.");

    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", original.bytes));
    const hash = toHex(digest);
    const stamp = Date.now();
    const ext = extForType(original.contentType);
    const thumbExt = extForType(thumb.contentType);
    const objectKey = `users/${auth.userId}/avatar-${stamp}-${hash.slice(0, 16)}.${ext}`;
    const thumbKey = `users/${auth.userId}/avatar-${stamp}-${hash.slice(0, 16)}-thumb.${thumbExt}`;

    await env.AVATAR_BUCKET.put(objectKey, original.bytes, {
      httpMetadata: { contentType: original.contentType, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { userId: auth.userId, variant: "full", hash },
    });
    await env.AVATAR_BUCKET.put(thumbKey, thumb.bytes, {
      httpMetadata: { contentType: thumb.contentType, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { userId: auth.userId, variant: "thumb", hash },
    });

    const base = (env.AVATAR_PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
    const avatarUrl = base
      ? `${base}/${encodeURIComponent(objectKey)}`
      : `/api/avatar/${objectKey.split("/").map((part) => encodeURIComponent(part)).join("/")}`;

    const prev = await getUserAvatarKeys(env, auth.userId);

    const user = await setUserAvatarAssets(env, auth.userId, {
      avatarUrl,
      avatarObjectKey: objectKey,
      avatarThumbKey: thumbKey,
      avatarHash: hash,
      avatarBytes: original.bytes.byteLength,
      avatarContentType: original.contentType,
    });

    if (prev.avatarObjectKey && prev.avatarObjectKey !== objectKey) {
      await env.AVATAR_BUCKET.delete(prev.avatarObjectKey);
    }
    if (prev.avatarThumbKey && prev.avatarThumbKey !== thumbKey) {
      await env.AVATAR_BUCKET.delete(prev.avatarThumbKey);
    }

    return withCors(
      request,
      json({
        ok: true,
        user,
        avatar: {
          url: avatarUrl,
          objectKey,
          thumbKey,
          hash,
          contentType: original.contentType,
          bytes: original.bytes.byteLength,
        },
      }),
    );
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
