import { useEffect, useState } from "react";

import {
  clearAdminSiteNotice,
  fetchAdminSiteNotice,
  publishAdminSiteNotice,
} from "../lib/cloudSiteNotice";
import {
  normalizeSiteNoticeDraft,
  SITE_NOTICE_MESSAGE_MAX_LENGTH,
  SITE_NOTICE_UPDATED_EVENT,
  type SiteNoticeDraft,
  type SiteNoticeTone,
} from "../lib/siteNotice";
import { getUiErrorMessage } from "../lib/uiError";
import { ActionButton } from "./ActionButton";
import { SiteNoticeSurface } from "./SiteNoticeBanner";

const EMPTY_DRAFT: SiteNoticeDraft = {
  active: true,
  tone: "information",
  message: "",
  dismissible: true,
  startsAt: null,
  expiresAt: null,
};

const toLocalDateTime = (iso: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const fromLocalDateTime = (value: string): string | null => value ? new Date(value).toISOString() : null;

export function SiteNoticeAdminForm() {
  const [draft, setDraft] = useState<SiteNoticeDraft>(EMPTY_DRAFT);
  const [expiresLocal, setExpiresLocal] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const notice = await fetchAdminSiteNotice();
        if (cancelled || !notice) return;
        setDraft({
          active: notice.active,
          tone: notice.tone,
          message: notice.message,
          dismissible: notice.dismissible,
          startsAt: notice.startsAt,
          expiresAt: notice.expiresAt,
        });
        setExpiresLocal(toLocalDateTime(notice.expiresAt));
      } catch (error) {
        if (!cancelled) setStatus(`Site notice unavailable: ${getUiErrorMessage(error)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const updateDraft = <K extends keyof SiteNoticeDraft>(key: K, value: SiteNoticeDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const publish = async () => {
    setBusy(true);
    setStatus("");
    try {
      const normalized = normalizeSiteNoticeDraft({
        ...draft,
        expiresAt: fromLocalDateTime(expiresLocal),
      });
      const notice = await publishAdminSiteNotice(normalized);
      setDraft({
        active: notice.active,
        tone: notice.tone,
        message: notice.message,
        dismissible: notice.dismissible,
        startsAt: notice.startsAt,
        expiresAt: notice.expiresAt,
      });
      setExpiresLocal(toLocalDateTime(notice.expiresAt));
      setStatus("Site notice published.");
      window.dispatchEvent(new CustomEvent(SITE_NOTICE_UPDATED_EVENT));
    } catch (error) {
      setStatus(`Publish failed: ${getUiErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove the current site notice?")) return;
    setBusy(true);
    setStatus("");
    try {
      await clearAdminSiteNotice();
      setDraft(EMPTY_DRAFT);
      setExpiresLocal("");
      setStatus("Site notice removed.");
      window.dispatchEvent(new CustomEvent(SITE_NOTICE_UPDATED_EVENT));
    } catch (error) {
      setStatus(`Remove failed: ${getUiErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="user-manager-list site-notice-admin" aria-labelledby="site-notice-admin-heading">
      <div className="section-heading">
        <div>
          <h3 id="site-notice-admin-heading">Site notice</h3>
          <p className="field-help">Publish one banner across LinkSim without deploying the application.</p>
        </div>
      </div>
      {loading ? <p className="field-help">Loading site notice…</p> : null}
      <label className="field-grid user-field-grid">
        <span>Notice tone</span>
        <select
          aria-label="Notice tone"
          className="locale-select"
          disabled={loading || busy}
          onChange={(event) => updateDraft("tone", event.target.value as SiteNoticeTone)}
          value={draft.tone}
        >
          <option value="information">Information</option>
          <option value="warning">Warning</option>
          <option value="incident">Incident</option>
        </select>
      </label>
      <label className="field-grid user-field-grid site-notice-message-field">
        <span>Notice message</span>
        <textarea
          aria-label="Notice message"
          disabled={loading || busy}
          maxLength={SITE_NOTICE_MESSAGE_MAX_LENGTH}
          onChange={(event) => updateDraft("message", event.target.value)}
          rows={3}
          value={draft.message}
        />
        <small className="field-help">{draft.message.length}/{SITE_NOTICE_MESSAGE_MAX_LENGTH}</small>
      </label>
      <label className="field-grid user-field-grid">
        <span>Expiry (optional)</span>
        <input
          disabled={loading || busy}
          onChange={(event) => setExpiresLocal(event.target.value)}
          type="datetime-local"
          value={expiresLocal}
        />
      </label>
      <div className="site-notice-options">
        <label>
          <input
            checked={draft.active}
            disabled={loading || busy}
            onChange={(event) => updateDraft("active", event.target.checked)}
            type="checkbox"
          />{" "}
          Active
        </label>
        <label>
          <input
            checked={draft.dismissible}
            disabled={loading || busy}
            onChange={(event) => updateDraft("dismissible", event.target.checked)}
            type="checkbox"
          />{" "}
          Dismissible
        </label>
      </div>
      {draft.active && draft.message.trim() ? (
        <SiteNoticeSurface notice={draft} preview />
      ) : (
        <p className="field-help">Enter an active message to preview the banner.</p>
      )}
      <div className="chip-group">
        <ActionButton disabled={loading || busy} onClick={() => void publish()} type="button">
          Publish notice
        </ActionButton>
        <ActionButton disabled={loading || busy} onClick={() => void remove()} type="button" variant="danger">
          Remove notice
        </ActionButton>
      </div>
      {status ? <p aria-live="polite" className="field-help">{status}</p> : null}
    </section>
  );
}
