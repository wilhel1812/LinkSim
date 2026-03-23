export const PROFILE_DRAFT_SITE_REQUEST_EVENT = "linksim:profile-draft-site-request";

export type ProfileDraftSiteRequestDetail = {
  lat: number;
  lon: number;
};

export const dispatchProfileDraftSiteRequest = (detail: ProfileDraftSiteRequestDetail): void => {
  window.dispatchEvent(new CustomEvent<ProfileDraftSiteRequestDetail>(PROFILE_DRAFT_SITE_REQUEST_EVENT, { detail }));
};
