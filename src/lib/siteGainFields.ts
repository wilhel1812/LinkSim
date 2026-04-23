export type SiteGainPair = {
  txGainDbi: number;
  rxGainDbi: number;
};

export const shouldUseSeparateSiteGain = (txGainDbi: number, rxGainDbi: number): boolean =>
  txGainDbi !== rxGainDbi;

export const getSyncedSiteGainPair = (gainDbi: number): SiteGainPair => ({
  txGainDbi: gainDbi,
  rxGainDbi: gainDbi,
});

export const collapseSiteGainToTx = (txGainDbi: number): SiteGainPair =>
  getSyncedSiteGainPair(txGainDbi);
