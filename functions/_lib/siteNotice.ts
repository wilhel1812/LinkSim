import {
  isSiteNoticeVisible,
  normalizeSiteNoticeDraft,
  type PublicSiteNotice,
  type SiteNotice,
  type SiteNoticeDraft,
} from "../../src/lib/siteNotice";
import type { Env } from "./types";

type SiteNoticeRow = {
  active: number;
  tone: string;
  message: string;
  dismissible: number;
  starts_at: string | null;
  expires_at: string | null;
  revision: number;
  updated_at: string;
  updated_by: string;
};

type NoticeActor = { actorId: string; source: string };

const toSiteNotice = (row: SiteNoticeRow): SiteNotice => {
  if ((row.active !== 0 && row.active !== 1) || (row.dismissible !== 0 && row.dismissible !== 1)) {
    throw new Error("Stored site notice has invalid boolean fields.");
  }
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) {
    throw new Error("Stored site notice has an invalid revision.");
  }
  if (typeof row.updated_by !== "string" || !row.updated_by.trim()) {
    throw new Error("Stored site notice has an invalid actor.");
  }
  const updatedAt = new Date(row.updated_at);
  if (!Number.isFinite(updatedAt.getTime())) {
    throw new Error("Stored site notice has an invalid update time.");
  }
  const draft = normalizeSiteNoticeDraft({
    active: row.active === 1,
    tone: row.tone,
    message: row.message,
    dismissible: row.dismissible === 1,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
  });
  return {
    ...draft,
    revision: row.revision,
    updatedAt: updatedAt.toISOString(),
    updatedBy: row.updated_by.trim(),
  };
};

const readRow = (env: Pick<Env, "DB">): Promise<SiteNoticeRow | null> =>
  env.DB.prepare(
    `SELECT active, tone, message, dismissible, starts_at, expires_at,
            revision, updated_at, updated_by
     FROM site_notice WHERE singleton = 1`,
  ).first<SiteNoticeRow>();

const isMissingTableError = (error: unknown): boolean =>
  String(error instanceof Error ? error.message : error).toLowerCase().includes("no such table: site_notice");

export const readSiteNotice = async (env: Pick<Env, "DB">): Promise<SiteNotice | null> => {
  const row = await readRow(env);
  return row ? toSiteNotice(row) : null;
};

export const readPublicSiteNotice = async (env: Pick<Env, "DB">): Promise<PublicSiteNotice | null> => {
  let notice: SiteNotice | null;
  try {
    notice = await readSiteNotice(env);
  } catch (error) {
    if (isMissingTableError(error) || error instanceof Error) return null;
    throw error;
  }
  if (!notice || !isSiteNoticeVisible(notice)) return null;
  return {
    tone: notice.tone,
    message: notice.message,
    dismissible: notice.dismissible,
    expiresAt: notice.expiresAt,
    revision: notice.revision,
    updatedAt: notice.updatedAt,
  };
};

const auditJson = (notice: SiteNotice | null): string | null => notice ? JSON.stringify(notice) : null;

const MAX_WRITE_ATTEMPTS = 3;

const writeSiteNotice = async (
  env: Pick<Env, "DB">,
  draft: SiteNoticeDraft,
  actor: NoticeActor,
  action: "publish" | "clear",
): Promise<SiteNotice> => {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const previous = await readSiteNotice(env);
    const now = new Date().toISOString();
    const next: SiteNotice = {
      ...draft,
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: now,
      updatedBy: actor.actorId,
    };
    const write = previous
      ? env.DB.prepare(
        `UPDATE site_notice SET
           active = ?, tone = ?, message = ?, dismissible = ?, starts_at = ?, expires_at = ?,
           revision = revision + 1, updated_at = ?, updated_by = ?
         WHERE singleton = 1 AND revision = ?`,
      ).bind(
        draft.active ? 1 : 0, draft.tone, draft.message, draft.dismissible ? 1 : 0,
        draft.startsAt, draft.expiresAt, now, actor.actorId, previous.revision,
      )
      : env.DB.prepare(
        `INSERT OR IGNORE INTO site_notice
          (singleton, active, tone, message, dismissible, starts_at, expires_at, revision, updated_at, updated_by)
         VALUES (1, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).bind(
        draft.active ? 1 : 0, draft.tone, draft.message, draft.dismissible ? 1 : 0,
        draft.startsAt, draft.expiresAt, now, actor.actorId,
      );
    const audit = env.DB.prepare(
      `INSERT INTO site_notice_audit
        (action, actor_id, source, previous_json, next_json, created_at)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE changes() = 1 AND EXISTS (
         SELECT 1 FROM site_notice
         WHERE singleton = 1 AND revision = ? AND updated_at = ? AND updated_by = ?
       )`,
    ).bind(
      action, actor.actorId, actor.source, auditJson(previous), JSON.stringify(next), now,
      next.revision, now, actor.actorId,
    );
    const [writeResult] = await env.DB.batch([write, audit]) as D1Result[];
    if (Number(writeResult?.meta?.changes ?? 0) > 0) return next;
  }
  throw new Error("Site notice changed concurrently. Try again.");
};

export const publishSiteNotice = async (
  env: Pick<Env, "DB">,
  value: SiteNoticeDraft,
  actor: NoticeActor,
): Promise<SiteNotice> => {
  const draft = normalizeSiteNoticeDraft(value);
  return writeSiteNotice(env, draft, actor, "publish");
};

export const clearSiteNotice = async (
  env: Pick<Env, "DB">,
  actor: NoticeActor,
): Promise<SiteNotice> => {
  const previous = await readSiteNotice(env);
  const draft: SiteNoticeDraft = {
    active: false,
    tone: previous?.tone ?? "information",
    message: "",
    dismissible: false,
    startsAt: null,
    expiresAt: null,
  };
  return writeSiteNotice(env, draft, actor, "clear");
};
