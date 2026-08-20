import { parseApiErrorMessage } from "./apiError";
import type { PublicSiteNotice, SiteNotice, SiteNoticeDraft } from "./siteNotice";

const parseResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const message = await parseApiErrorMessage(response);
    throw new Error(`${response.status} ${response.statusText}: ${message}`);
  }
  return response.json() as Promise<T>;
};

export const fetchPublicSiteNotice = async (): Promise<PublicSiteNotice | null> => {
  const response = await fetch("/site-status.json", {
    method: "GET",
    cache: "no-cache",
    headers: { accept: "application/json" },
  });
  const data = await parseResponse<{ notice?: PublicSiteNotice | null }>(response);
  return data.notice ?? null;
};

export const fetchAdminSiteNotice = async (): Promise<SiteNotice | null> => {
  const response = await fetch("/api/admin-site-notice", {
    method: "GET",
    headers: { accept: "application/json" },
  });
  const data = await parseResponse<{ notice?: SiteNotice | null }>(response);
  return data.notice ?? null;
};

export const publishAdminSiteNotice = async (draft: SiteNoticeDraft): Promise<SiteNotice> => {
  const response = await fetch("/api/admin-site-notice", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  const data = await parseResponse<{ notice: SiteNotice }>(response);
  return data.notice;
};

export const clearAdminSiteNotice = async (): Promise<null> => {
  const response = await fetch("/api/admin-site-notice", { method: "DELETE" });
  await parseResponse<{ notice: null }>(response);
  return null;
};
