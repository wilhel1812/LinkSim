import type { Link, Site } from "../types/radio";

type SelectionEffectiveLinkInput = {
  links: Link[];
  fromSite: Site;
  toSite: Site;
  frequencyMHz: number;
};

export const buildSelectionEffectiveLink = ({
  links,
  fromSite,
  toSite,
  frequencyMHz,
}: SelectionEffectiveLinkInput): Link => {
  const saved = links.find(
    (link) =>
      (link.fromSiteId === fromSite.id && link.toSiteId === toSite.id) ||
      (link.fromSiteId === toSite.id && link.toSiteId === fromSite.id),
  );

  if (saved) {
    return { ...saved, frequencyMHz };
  }

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
