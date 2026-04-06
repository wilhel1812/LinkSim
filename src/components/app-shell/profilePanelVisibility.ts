export const isProfileSelectionEligible = (selectedSiteCount: number): boolean =>
  selectedSiteCount === 1 || selectedSiteCount === 2;

type NextProfileHiddenInput = {
  nextSelectedSiteCount: number;
};

export const nextProfileHiddenForSelectionChange = ({
  nextSelectedSiteCount,
}: NextProfileHiddenInput): boolean => {
  if (!isProfileSelectionEligible(nextSelectedSiteCount)) {
    return true;
  }
  return false;
};
