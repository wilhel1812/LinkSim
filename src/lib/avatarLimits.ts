export const AVATAR_REQUEST_MAX_BYTES = 8_000_090;
export const AVATAR_REQUEST_JSON_DEPTH = 1;
export const AVATAR_FULL_MAX_BYTES = 5_000_000;
export const AVATAR_THUMB_MAX_BYTES = 1_000_000;
export const AVATAR_OBJECT_KEY_MAX_CHARS = 91;

export const AVATAR_CONTENT_TYPES = ["image/webp", "image/png", "image/jpeg"] as const;
export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number];

const contentTypes = new Set<string>(AVATAR_CONTENT_TYPES);
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const avatarKeyPattern = new RegExp(
  `^users/(${uuid})/avatar-(?:[0-9a-f]{16}|[0-9]{13}-[0-9a-f]{16})(?:-thumb)?\\.(?:webp|png|jpg)$`,
  "u",
);

const hasMagic = (contentType: AvatarContentType, bytes: Uint8Array): boolean => {
  if (contentType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((value, index) => bytes[index] === value);
  }
  if (contentType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
};

export const assertAvatarFormat = (contentType: string, bytes: Uint8Array): AvatarContentType => {
  const normalized = contentType.split(";", 1)[0].trim().toLowerCase();
  if (!contentTypes.has(normalized)) throw new Error("Unsupported avatar image type.");
  if (!hasMagic(normalized as AvatarContentType, bytes)) {
    throw new Error("Avatar image data does not match its declared format.");
  }
  return normalized as AvatarContentType;
};

export const parseAvatarDataUrl = (
  value: unknown,
  maxBytes: number,
): { contentType: AvatarContentType; bytes: Uint8Array } => {
  if (typeof value !== "string") throw new Error("Image payload must be a data URL.");
  const trimmed = value.trim();
  const comma = trimmed.indexOf(",");
  const header = comma >= 0 ? trimmed.slice(0, comma) : "";
  const contentType = header.startsWith("data:") && header.endsWith(";base64")
    ? header.slice(5, -7).toLowerCase()
    : "";
  if (!contentTypes.has(contentType)) throw new Error("Unsupported image format. Use webp, png, or jpeg.");
  const base64 = trimmed.slice(comma + 1);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  if (!base64 || base64.length % 4 !== 0) throw new Error("Image payload must use strict base64 encoding.");
  for (let index = 0; index < base64.length - padding; index += 1) {
    const code = base64.charCodeAt(index);
    const valid = (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)
      || (code >= 0x30 && code <= 0x39) || code === 0x2b || code === 0x2f;
    if (!valid) throw new Error("Image payload must use strict base64 encoding.");
  }
  for (let index = base64.length - padding; index < base64.length; index += 1) {
    if (base64[index] !== "=") throw new Error("Image payload must use strict base64 encoding.");
  }
  if ((base64.endsWith("==") && (alphabet.indexOf(base64.at(-3) ?? "") & 0x0f) !== 0)
    || (base64.endsWith("=") && !base64.endsWith("==") && (alphabet.indexOf(base64.at(-2) ?? "") & 0x03) !== 0)) {
    throw new Error("Image payload must use strict base64 encoding.");
  }
  const estimatedBytes = Math.floor(base64.length / 4) * 3 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (estimatedBytes > maxBytes) throw new Error("Avatar image too large.");
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error("Image payload must use strict base64 encoding.");
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (bytes.byteLength > maxBytes) throw new Error("Avatar image too large.");
  const validatedType = assertAvatarFormat(contentType, bytes);
  return { contentType: validatedType, bytes };
};

export const parseAvatarObjectKey = (value: string): string => {
  if (typeof value !== "string" || !value || value.length > AVATAR_OBJECT_KEY_MAX_CHARS
    || value.includes("%") || value.includes("\\") || !avatarKeyPattern.test(value)) {
    throw new Error("Avatar key is invalid.");
  }
  return value;
};

export const avatarUrlForObjectKey = (key: string, publicBaseUrl = ""): string => {
  const validKey = parseAvatarObjectKey(key);
  const rawBase = publicBaseUrl.trim();
  let base = "";
  if (rawBase) {
    try {
      const parsed = new URL(rawBase);
      if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password
        || parsed.search || parsed.hash) throw new Error("invalid");
      base = parsed.toString().replace(/\/+$/u, "");
    } catch {
      throw new Error("Avatar public URL is invalid.");
    }
  }
  return base
    ? `${base}/${encodeURIComponent(validKey)}`
    : `/api/avatar/${validKey.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
};

export const avatarVariantMaxBytes = (key: string): number =>
  parseAvatarObjectKey(key).includes("-thumb.") ? AVATAR_THUMB_MAX_BYTES : AVATAR_FULL_MAX_BYTES;

export const readBoundedAvatarBody = async (response: Response, maxBytes: number): Promise<Uint8Array> => {
  const rawLength = response.headers.get("content-length");
  const declaredLength = rawLength === null ? null : Number(rawLength);
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Avatar response exceeds its size limit.");
  }
  if (!response.body) throw new Error("Avatar response body is missing.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Avatar response exceeds its size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export const thumbnailAvatarUrl = (avatarUrl: string | null | undefined, thumbKey: string | null | undefined): string => {
  const full = typeof avatarUrl === "string" ? avatarUrl : "";
  if (!full.startsWith("/api/avatar/") || !thumbKey) return full;
  try {
    return avatarUrlForObjectKey(thumbKey);
  } catch {
    return full;
  }
};
