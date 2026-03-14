import type { Link, Site } from "../types/radio";

export const STANDARD_SITE_RADIO: {
  txPowerDbm: number;
  txGainDbi: number;
  rxGainDbi: number;
  cableLossDb: number;
} = {
  txPowerDbm: 22,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
};

export type SiteRadio = typeof STANDARD_SITE_RADIO;

const pickModeNumber = (values: number[]): number | null => {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let bestValue = values[0];
  let bestCount = counts.get(bestValue) ?? 0;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      bestValue = value;
      bestCount = count;
    }
  }
  return bestValue;
};

const sameNumber = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

export const withSiteRadioDefaults = (site: Site): Site => ({
  ...site,
  txPowerDbm:
    typeof site.txPowerDbm === "number" && Number.isFinite(site.txPowerDbm)
      ? site.txPowerDbm
      : STANDARD_SITE_RADIO.txPowerDbm,
  txGainDbi:
    typeof site.txGainDbi === "number" && Number.isFinite(site.txGainDbi)
      ? site.txGainDbi
      : STANDARD_SITE_RADIO.txGainDbi,
  rxGainDbi:
    typeof site.rxGainDbi === "number" && Number.isFinite(site.rxGainDbi)
      ? site.rxGainDbi
      : STANDARD_SITE_RADIO.rxGainDbi,
  cableLossDb:
    typeof site.cableLossDb === "number" && Number.isFinite(site.cableLossDb)
      ? site.cableLossDb
      : STANDARD_SITE_RADIO.cableLossDb,
});

export const resolveLinkRadio = (
  link: Link,
  fromSite?: Site | null,
  toSite?: Site | null,
): SiteRadio => ({
  txPowerDbm: link.txPowerDbm ?? fromSite?.txPowerDbm ?? STANDARD_SITE_RADIO.txPowerDbm,
  txGainDbi: link.txGainDbi ?? fromSite?.txGainDbi ?? STANDARD_SITE_RADIO.txGainDbi,
  rxGainDbi: link.rxGainDbi ?? toSite?.rxGainDbi ?? STANDARD_SITE_RADIO.rxGainDbi,
  cableLossDb: link.cableLossDb ?? fromSite?.cableLossDb ?? STANDARD_SITE_RADIO.cableLossDb,
});

export const stripRedundantLinkRadioOverrides = (
  link: Link,
  fromSite?: Site | null,
  toSite?: Site | null,
): Link => {
  const resolved = resolveLinkRadio(link, fromSite, toSite);
  return {
    ...link,
    txPowerDbm:
      typeof link.txPowerDbm === "number" && !sameNumber(link.txPowerDbm, resolved.txPowerDbm)
        ? link.txPowerDbm
        : undefined,
    txGainDbi:
      typeof link.txGainDbi === "number" && !sameNumber(link.txGainDbi, resolved.txGainDbi)
        ? link.txGainDbi
        : undefined,
    rxGainDbi:
      typeof link.rxGainDbi === "number" && !sameNumber(link.rxGainDbi, resolved.rxGainDbi)
        ? link.rxGainDbi
        : undefined,
    cableLossDb:
      typeof link.cableLossDb === "number" && !sameNumber(link.cableLossDb, resolved.cableLossDb)
        ? link.cableLossDb
        : undefined,
  };
};

export const hasLinkRadioOverrides = (link: Link): boolean =>
  typeof link.txPowerDbm === "number" ||
  typeof link.txGainDbi === "number" ||
  typeof link.rxGainDbi === "number" ||
  typeof link.cableLossDb === "number";

export const migrateSitesAndLinksToSiteRadioDefaults = (
  inputSites: Site[],
  inputLinks: Link[],
): { sites: Site[]; links: Link[] } => {
  const sitesById = new Map(inputSites.map((site) => [site.id, withSiteRadioDefaults(site)]));
  const sites = inputSites.map((site) => sitesById.get(site.id) ?? withSiteRadioDefaults(site));

  for (const site of sites) {
    const outgoing = inputLinks.filter((link) => link.fromSiteId === site.id);
    const incoming = inputLinks.filter((link) => link.toSiteId === site.id);

    const txPowerCandidates = outgoing
      .map((link) => link.txPowerDbm)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const txGainCandidates = outgoing
      .map((link) => link.txGainDbi)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const rxGainCandidates = incoming
      .map((link) => link.rxGainDbi)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const cableLossCandidates = outgoing
      .map((link) => link.cableLossDb)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    const txPowerMode = pickModeNumber(txPowerCandidates);
    const txGainMode = pickModeNumber(txGainCandidates);
    const rxGainMode = pickModeNumber(rxGainCandidates);
    const cableLossMode = pickModeNumber(cableLossCandidates);

    site.txPowerDbm = txPowerMode ?? site.txPowerDbm ?? STANDARD_SITE_RADIO.txPowerDbm;
    site.txGainDbi = txGainMode ?? site.txGainDbi ?? STANDARD_SITE_RADIO.txGainDbi;
    site.rxGainDbi = rxGainMode ?? site.rxGainDbi ?? STANDARD_SITE_RADIO.rxGainDbi;
    site.cableLossDb = cableLossMode ?? site.cableLossDb ?? STANDARD_SITE_RADIO.cableLossDb;
  }

  const linkSitesById = new Map(sites.map((site) => [site.id, site]));
  const links = inputLinks.map((link) =>
    stripRedundantLinkRadioOverrides(
      link,
      linkSitesById.get(link.fromSiteId),
      linkSitesById.get(link.toSiteId),
    ),
  );

  return { sites, links };
};
