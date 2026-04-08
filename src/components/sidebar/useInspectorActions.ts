import { useState } from "react";
import { resolveLinkRadio } from "../../lib/linkRadio";
import type { Link, Site } from "../../types/radio";

export type LinkModalState = {
  mode: "add" | "edit";
  linkId: string | null;
  name: string;
  fromSiteId: string;
  toSiteId: string;
  overrideRadio: boolean;
  txPowerDbm: number;
  txGainDbi: number;
  rxGainDbi: number;
  cableLossDb: number;
  status: string;
} | null;

type UseInspectorActionsParams = {
  selectedLink: Link;
  selectedLinkRaw: Link | null;
  selectedSite: Site | null;
  sites: Site[];
};

export function useInspectorActions({
  selectedLink,
  selectedLinkRaw,
  selectedSite,
  sites,
}: UseInspectorActionsParams) {
  const [linkModal, setLinkModal] = useState<LinkModalState>(null);
  const canEditExistingPath = Boolean(selectedLinkRaw && !selectedLinkRaw.id.startsWith("__"));

  const openAddLinkModal = () => {
    const hasFromInSites = sites.some((site) => site.id === selectedLink.fromSiteId);
    const hasToInSites = sites.some((site) => site.id === selectedLink.toSiteId);
    const fallbackFrom = hasFromInSites ? selectedLink.fromSiteId : sites[0]?.id || "";
    const fallbackTo = hasToInSites
      ? selectedLink.toSiteId
      : sites.find((site) => site.id !== fallbackFrom)?.id || "";
    const fallbackFromSite = sites.find((site) => site.id === fallbackFrom) ?? selectedSite;
    const fallbackToSite = sites.find((site) => site.id === fallbackTo) ?? fallbackFromSite;
    const baseRadio = resolveLinkRadio(selectedLink, fallbackFromSite, fallbackToSite);
    setLinkModal({
      mode: "add",
      linkId: null,
      name: "",
      fromSiteId: fallbackFrom,
      toSiteId: fallbackTo,
      overrideRadio: false,
      txPowerDbm: baseRadio.txPowerDbm,
      txGainDbi: baseRadio.txGainDbi,
      rxGainDbi: baseRadio.rxGainDbi,
      cableLossDb: baseRadio.cableLossDb,
      status: "",
    });
  };

  const openEditLinkModal = () => {
    if (!canEditExistingPath || !selectedLinkRaw) return;
    const fromSite = sites.find((site) => site.id === selectedLink.fromSiteId) ?? null;
    const toSite = sites.find((site) => site.id === selectedLink.toSiteId) ?? null;
    const baseRadio = resolveLinkRadio(selectedLink, fromSite, toSite);
    const hasOverrides = Boolean(
      selectedLinkRaw &&
        (typeof selectedLinkRaw.txPowerDbm === "number" ||
          typeof selectedLinkRaw.txGainDbi === "number" ||
          typeof selectedLinkRaw.rxGainDbi === "number" ||
          typeof selectedLinkRaw.cableLossDb === "number"),
    );
    setLinkModal({
      mode: "edit",
      linkId: selectedLinkRaw.id,
      name: selectedLink.name ?? "",
      fromSiteId: selectedLink.fromSiteId,
      toSiteId: selectedLink.toSiteId,
      overrideRadio: hasOverrides,
      txPowerDbm: baseRadio.txPowerDbm,
      txGainDbi: baseRadio.txGainDbi,
      rxGainDbi: baseRadio.rxGainDbi,
      cableLossDb: baseRadio.cableLossDb,
      status: "",
    });
  };

  return {
    linkModal,
    setLinkModal,
    openAddLinkModal,
    openEditLinkModal,
    canEditExistingPath,
  };
}
