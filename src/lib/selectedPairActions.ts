type SaveSelectedLinkActionInput = {
  canPersist: boolean;
  fromSiteId: string | null;
  toSiteId: string | null;
};

export const canShowSaveSelectedLinkAction = (input: SaveSelectedLinkActionInput): boolean => {
  if (!input.canPersist) return false;
  if (!input.fromSiteId || !input.toSiteId) return false;
  return input.fromSiteId !== input.toSiteId;
};
