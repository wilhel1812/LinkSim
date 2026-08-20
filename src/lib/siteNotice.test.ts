import { describe, expect, it } from "vitest";

import {
  SITE_NOTICE_MESSAGE_MAX_LENGTH,
  buildSiteNoticeDismissKey,
  isSiteNoticeVisible,
  normalizeSiteNoticeDraft,
} from "./siteNotice";

describe("site notice contract", () => {
  it("normalizes a publishable plain-text notice", () => {
    expect(normalizeSiteNoticeDraft({
      active: true,
      tone: "warning",
      message: "  LinkSim is temporarily not accepting new user registrations.  ",
      dismissible: false,
      startsAt: null,
      expiresAt: "2026-08-21T12:00:00.000Z",
    })).toEqual({
      active: true,
      tone: "warning",
      message: "LinkSim is temporarily not accepting new user registrations.",
      dismissible: false,
      startsAt: null,
      expiresAt: "2026-08-21T12:00:00.000Z",
    });
  });

  it("rejects invalid tone, empty active content, and oversized messages", () => {
    expect(() => normalizeSiteNoticeDraft({ active: true, tone: "success", message: "Nope" })).toThrow(
      "Notice tone must be information, warning, or incident.",
    );
    expect(() => normalizeSiteNoticeDraft({ active: true, tone: "warning", message: "  " })).toThrow(
      "An active notice requires a message.",
    );
    expect(() => normalizeSiteNoticeDraft({
      active: true,
      tone: "warning",
      message: "x".repeat(SITE_NOTICE_MESSAGE_MAX_LENGTH + 1),
    })).toThrow(`Notice message may not exceed ${SITE_NOTICE_MESSAGE_MAX_LENGTH} characters.`);
  });

  it("requires timezone-bearing ISO-8601 activation and expiry timestamps", () => {
    const base = { active: true, tone: "warning", message: "Maintenance", dismissible: true };
    expect(() => normalizeSiteNoticeDraft({ ...base, expiresAt: "2026" })).toThrow(
      "Notice expiry must be an ISO-8601 timestamp.",
    );
    expect(() => normalizeSiteNoticeDraft({ ...base, expiresAt: "08/21/2026 12:00" })).toThrow(
      "Notice expiry must be an ISO-8601 timestamp.",
    );
    expect(normalizeSiteNoticeDraft({
      ...base,
      startsAt: "2026-08-21T12:00:00+02:00",
      expiresAt: "2026-08-21T13:00:00+02:00",
    })).toMatchObject({
      startsAt: "2026-08-21T10:00:00.000Z",
      expiresAt: "2026-08-21T11:00:00.000Z",
    });
  });

  it("honors activation and expiry windows", () => {
    const notice = {
      active: true,
      tone: "warning" as const,
      message: "Planned maintenance",
      dismissible: false,
      startsAt: "2026-08-20T10:00:00.000Z",
      expiresAt: "2026-08-20T12:00:00.000Z",
      revision: 3,
      updatedAt: "2026-08-20T09:00:00.000Z",
    };
    expect(isSiteNoticeVisible(notice, new Date("2026-08-20T09:59:59.000Z"))).toBe(false);
    expect(isSiteNoticeVisible(notice, new Date("2026-08-20T10:00:00.000Z"))).toBe(true);
    expect(isSiteNoticeVisible(notice, new Date("2026-08-20T12:00:00.000Z"))).toBe(false);
  });

  it("keys dismissal to the notice revision", () => {
    expect(buildSiteNoticeDismissKey({ revision: 7 })).toBe("linksim:site-notice-dismissed:v1:7");
    expect(buildSiteNoticeDismissKey({ revision: 8 })).not.toBe(
      buildSiteNoticeDismissKey({ revision: 7 }),
    );
  });
});
