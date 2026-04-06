export const isProfileSelectionEligible = (selectedSiteCount: number): boolean =>
  selectedSiteCount === 1 || selectedSiteCount === 2;

type NextProfileHiddenInput = {
  currentHidden: boolean;
  nextSelectedSiteCount: number;
};

export const nextProfileHiddenForSelectionChange = ({
  currentHidden,
  nextSelectedSiteCount,
}: NextProfileHiddenInput): boolean => {
  if (!isProfileSelectionEligible(nextSelectedSiteCount)) {
    return true;
  }
  return currentHidden;
};
