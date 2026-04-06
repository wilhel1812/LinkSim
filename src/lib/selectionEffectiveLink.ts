import type { Link, Site } from "../types/radio";

type SelectionEffectiveLinkInput = {
  fromSite: Site;
  toSite: Site;
  frequencyMHz: number;
};

export const buildSelectionEffectiveLink = ({
  fromSite,
  toSite,
  frequencyMHz,
}: SelectionEffectiveLinkInput): Link => {
  return {
    id: "__selection__",
    name: `${fromSite.name} -> ${toSite.name}`,
    fromSiteId: fromSite.id,
    toSiteId: toSite.id,
    frequencyMHz,
    txPowerDbm: fromSite.txPowerDbm,
    txGainDbi: fromSite.txGainDbi,
    rxGainDbi: toSite.rxGainDbi,
    cableLossDb: fromSite.cableLossDb,
  };
};
