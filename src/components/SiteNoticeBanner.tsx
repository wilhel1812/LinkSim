import { CircleAlert, CircleX, Info, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { fetchPublicSiteNotice } from "../lib/cloudSiteNotice";
import {
  buildSiteNoticeDismissKey,
  SITE_NOTICE_UPDATED_EVENT,
  type PublicSiteNotice,
} from "../lib/siteNotice";

const REFRESH_INTERVAL_MS = 60_000;

const isDismissed = (notice: PublicSiteNotice): boolean => {
  if (!notice.dismissible) return false;
  try {
    return window.localStorage.getItem(buildSiteNoticeDismissKey(notice)) === "1";
  } catch {
    return false;
  }
};

export function SiteNoticeSurface({
  notice,
  onDismiss,
  preview = false,
}: {
  notice: Pick<PublicSiteNotice, "tone" | "message" | "dismissible">;
  onDismiss?: () => void;
  preview?: boolean;
}) {
  const isIncident = notice.tone === "incident";
  return (
    <div
      aria-atomic="true"
      aria-label={preview ? "Notice preview" : undefined}
      aria-live={preview ? "off" : isIncident ? "assertive" : "polite"}
      className={`site-notice-banner site-notice-banner-${notice.tone} ${preview ? "site-notice-banner-preview" : ""}`.trim()}
      role={preview ? undefined : isIncident ? "alert" : "status"}
    >
      <span className="site-notice-banner-icon" aria-hidden="true">
        {notice.tone === "information" ? <Info size={16} strokeWidth={2} /> : null}
        {notice.tone === "warning" ? <CircleAlert size={16} strokeWidth={2} /> : null}
        {notice.tone === "incident" ? <CircleX size={16} strokeWidth={2} /> : null}
      </span>
      <span className="site-notice-banner-message">{notice.message}</span>
      {notice.dismissible && onDismiss ? (
        <button
          aria-label="Dismiss site notice"
          className="site-notice-banner-dismiss"
          onClick={onDismiss}
          title="Dismiss site notice"
          type="button"
        >
          <X aria-hidden="true" size={15} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}

export function SiteNoticeBanner() {
  const [notice, setNotice] = useState<PublicSiteNotice | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchPublicSiteNotice();
      setNotice(next && !isDismissed(next) ? next : null);
    } catch {
      setNotice(null);
    }
  }, []);

  useEffect(() => {
    const refresh = () => void load();
    const initial = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    window.addEventListener(SITE_NOTICE_UPDATED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener(SITE_NOTICE_UPDATED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  if (!notice) return null;
  return (
    <SiteNoticeSurface
      notice={notice}
      onDismiss={notice.dismissible ? () => {
        try {
          window.localStorage.setItem(buildSiteNoticeDismissKey(notice), "1");
        } catch {
          // Best effort only.
        }
        setNotice(null);
      } : undefined}
    />
  );
}
