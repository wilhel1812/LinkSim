export const SITE_NOTICE_MESSAGE_MAX_LENGTH = 280;
export const SITE_NOTICE_UPDATED_EVENT = "linksim:site-notice-updated";

export type SiteNoticeTone = "information" | "warning" | "incident";

export type SiteNoticeDraft = {
  active: boolean;
  tone: SiteNoticeTone;
  message: string;
  dismissible: boolean;
  startsAt: string | null;
  expiresAt: string | null;
};

export type SiteNotice = SiteNoticeDraft & {
  revision: number;
  updatedAt: string;
  updatedBy: string;
};

export type PublicSiteNotice = Omit<SiteNotice, "active" | "startsAt" | "updatedBy">;

const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const normalizeInstant = (value: unknown, label: string): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} must be an ISO-8601 timestamp.`);
  const instant = value.trim();
  if (!ISO_INSTANT_PATTERN.test(instant)) throw new Error(`${label} must be an ISO-8601 timestamp.`);
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} must be an ISO-8601 timestamp.`);
  return parsed.toISOString();
};

export const normalizeSiteNoticeDraft = (value: unknown): SiteNoticeDraft => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Site notice must be a valid object.");
  }
  const input = value as Record<string, unknown>;
  const tone = input.tone;
  if (tone !== "information" && tone !== "warning" && tone !== "incident") {
    throw new Error("Notice tone must be information, warning, or incident.");
  }
  if (typeof input.message !== "string") throw new Error("Notice message is required.");
  const message = input.message.trim().replace(/\s+/g, " ");
  const active = input.active === true;
  if (active && !message) throw new Error("An active notice requires a message.");
  if (message.length > SITE_NOTICE_MESSAGE_MAX_LENGTH) {
    throw new Error(`Notice message may not exceed ${SITE_NOTICE_MESSAGE_MAX_LENGTH} characters.`);
  }
  const startsAt = normalizeInstant(input.startsAt, "Notice start");
  const expiresAt = normalizeInstant(input.expiresAt, "Notice expiry");
  if (startsAt && expiresAt && Date.parse(expiresAt) <= Date.parse(startsAt)) {
    throw new Error("Notice expiry must be after its start time.");
  }
  return {
    active,
    tone,
    message,
    dismissible: input.dismissible === true,
    startsAt,
    expiresAt,
  };
};

export const isSiteNoticeVisible = (
  notice: Pick<SiteNotice, "active" | "startsAt" | "expiresAt">,
  now = new Date(),
): boolean => {
  if (!notice.active) return false;
  const nowMs = now.getTime();
  if (notice.startsAt && nowMs < Date.parse(notice.startsAt)) return false;
  if (notice.expiresAt && nowMs >= Date.parse(notice.expiresAt)) return false;
  return true;
};

export const buildSiteNoticeDismissKey = (notice: Pick<SiteNotice, "revision">): string =>
  `linksim:site-notice-dismissed:v1:${notice.revision}`;
