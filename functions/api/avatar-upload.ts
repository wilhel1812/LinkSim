import { verifyAuth } from "../_lib/auth";
import { ensureUser, fetchUserProfile, getUserAvatarKeys, setUserAvatarAssets } from "../_lib/db";
import { ApiRequestError, errorResponse, handleOptions, json, readBoundedJson, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";
import {
  AVATAR_FULL_MAX_BYTES,
  AVATAR_REQUEST_JSON_DEPTH,
  AVATAR_REQUEST_MAX_BYTES,
  AVATAR_THUMB_MAX_BYTES,
  avatarUrlForObjectKey,
  parseAvatarDataUrl,
} from "../../src/lib/avatarLimits";

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

    const body = await readBoundedJson<{
      originalDataUrl?: unknown;
      thumbDataUrl?: unknown;
    }>(request, { maxBytes: AVATAR_REQUEST_MAX_BYTES, maxDepth: AVATAR_REQUEST_JSON_DEPTH });

    let original: ReturnType<typeof parseAvatarDataUrl>;
    let thumb: ReturnType<typeof parseAvatarDataUrl>;
    try {
      original = parseAvatarDataUrl(body.originalDataUrl, AVATAR_FULL_MAX_BYTES);
      thumb = parseAvatarDataUrl(body.thumbDataUrl, AVATAR_THUMB_MAX_BYTES);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Avatar payload is invalid.";
      throw new ApiRequestError(message, message.includes("too large") ? 413 : 400, "invalid_avatar");
    }

    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", original.bytes));
    const hash = toHex(digest);
    const opaqueKey = crypto.randomUUID();
    const ext = extForType(original.contentType);
    const thumbExt = extForType(thumb.contentType);
    const objectKey = `users/${opaqueKey}/avatar-${hash.slice(0, 16)}.${ext}`;
    const thumbKey = `users/${opaqueKey}/avatar-${hash.slice(0, 16)}-thumb.${thumbExt}`;

    const prev = await getUserAvatarKeys(env, auth.userId);
    const avatarUrl = avatarUrlForObjectKey(objectKey, env.AVATAR_PUBLIC_BASE_URL);
    const writtenKeys: string[] = [];
    let user: Awaited<ReturnType<typeof setUserAvatarAssets>>;
    try {
      await env.AVATAR_BUCKET.put(objectKey, original.bytes, {
        httpMetadata: { contentType: original.contentType, cacheControl: "public, max-age=31536000, immutable" },
        customMetadata: { userId: auth.userId, variant: "full", hash },
      });
      writtenKeys.push(objectKey);
      await env.AVATAR_BUCKET.put(thumbKey, thumb.bytes, {
        httpMetadata: { contentType: thumb.contentType, cacheControl: "public, max-age=31536000, immutable" },
        customMetadata: { userId: auth.userId, variant: "thumb", hash },
      });
      writtenKeys.push(thumbKey);
      user = await setUserAvatarAssets(env, auth.userId, {
        avatarUrl,
        avatarObjectKey: objectKey,
        avatarThumbKey: thumbKey,
        avatarHash: hash,
        avatarBytes: original.bytes.byteLength,
        avatarContentType: original.contentType,
      });
    } catch (error) {
      await Promise.allSettled(writtenKeys.map((key) => env.AVATAR_BUCKET!.delete(key)));
      throw error;
    }
    await Promise.allSettled([
      ...(prev.avatarObjectKey && prev.avatarObjectKey !== objectKey ? [env.AVATAR_BUCKET.delete(prev.avatarObjectKey)] : []),
      ...(prev.avatarThumbKey && prev.avatarThumbKey !== thumbKey ? [env.AVATAR_BUCKET.delete(prev.avatarThumbKey)] : []),
    ]);

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
