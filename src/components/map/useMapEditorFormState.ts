import { useEffect, useState } from "react";
import { collapseSiteGainToTx, getSyncedSiteGainPair, shouldUseSeparateSiteGain } from "../../lib/siteGainFields";
import { resolveLinkRadio, STANDARD_SITE_RADIO } from "../../lib/linkRadio";
import { toAccessVisibility } from "../../lib/uiFormatting";
import { fetchCollaboratorDirectory } from "../../lib/cloudUser";
import { fetchElevations } from "../../lib/elevationService";
import { searchLocations, type GeocodeResult } from "../../lib/geocode";
import { sampleSrtmElevation } from "../../lib/srtm";
import { getUiErrorMessage } from "../../lib/uiError";
import { useAppStore } from "../../store/appStore";
import type { CollaboratorDirectoryUser } from "../../lib/cloudUser";
import type { AccessRole, AccessVisibility } from "../AccessSettingsEditor";

const parseNumber = (value: string | number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function useMapEditorFormState() {
  const mapEditor = useAppStore((state) => state.mapEditor);
  const closeMapEditor = useAppStore((state) => state.closeMapEditor);
  const siteLibrary = useAppStore((state) => state.siteLibrary);
  const simulationPresets = useAppStore((state) => state.simulationPresets);
  const sites = useAppStore((state) => state.sites);
  const links = useAppStore((state) => state.links);
  const srtmTiles = useAppStore((state) => state.srtmTiles);
  const mapViewport = useAppStore((state) => state.mapViewport);
  const updateMapViewport = useAppStore((state) => state.updateMapViewport);
  const currentUser = useAppStore((state) => state.currentUser);
  const isEditorTerrainFetching = useAppStore((state) => state.isEditorTerrainFetching);
  const loadTerrainForCoordinate = useAppStore((state) => state.loadTerrainForCoordinate);
  const updateSiteLibraryEntry = useAppStore((state) => state.updateSiteLibraryEntry);
  const addSiteLibraryEntry = useAppStore((state) => state.addSiteLibraryEntry);
  const insertSiteFromLibrary = useAppStore((state) => state.insertSiteFromLibrary);
  const updateSimulationPresetEntry = useAppStore((state) => state.updateSimulationPresetEntry);
  const createBlankSimulationPreset = useAppStore((state) => state.createBlankSimulationPreset);
  const loadSimulationPreset = useAppStore((state) => state.loadSimulationPreset);
  const selectedFrequencyPresetId = useAppStore((state) => state.selectedFrequencyPresetId);
  const autoPropagationEnvironment = useAppStore((state) => state.autoPropagationEnvironment);
  const createLink = useAppStore((state) => state.createLink);
  const updateLink = useAppStore((state) => state.updateLink);

  // ─── Shared status ───────────────────────────────────────────────────────────
  const [status, setStatus] = useState("");

  // ─── Site / Simulation shared drafts ─────────────────────────────────────────
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [accessVisibility, setAccessVisibility] = useState<AccessVisibility>("private");
  const [collaboratorUserIds, setCollaboratorUserIds] = useState<string[]>([]);
  const [collaboratorRoles, setCollaboratorRoles] = useState<Record<string, AccessRole>>({});
  const [collaboratorDirectory, setCollaboratorDirectory] = useState<CollaboratorDirectoryUser[]>([]);
  const [collaboratorDirectoryBusy, setCollaboratorDirectoryBusy] = useState(false);
  const [collaboratorDirectoryStatus, setCollaboratorDirectoryStatus] = useState("");

  // ─── Site-specific drafts ─────────────────────────────────────────────────────
  const [latDraft, setLatDraft] = useState(0);
  const [lonDraft, setLonDraft] = useState(0);
  const [groundDraft, setGroundDraft] = useState(0);
  const [antennaDraft, setAntennaDraft] = useState(2);
  const [txPowerDraft, setTxPowerDraft] = useState(STANDARD_SITE_RADIO.txPowerDbm);
  const [txGainDraft, setTxGainDraft] = useState(STANDARD_SITE_RADIO.txGainDbi);
  const [rxGainDraft, setRxGainDraft] = useState(STANDARD_SITE_RADIO.rxGainDbi);
  const [separateGain, setSeparateGain] = useState(false);
  const [cableLossDraft, setCableLossDraft] = useState(STANDARD_SITE_RADIO.cableLossDb);
  const [isElevationUserSet, setIsElevationUserSet] = useState(false);
  const [siteSourceMeta, setSiteSourceMeta] = useState<NonNullable<NonNullable<typeof mapEditor>["siteSeed"]>["sourceMeta"]>();
  const [insertSiteAfterSave, setInsertSiteAfterSave] = useState(false);
  const [siteSearchQuery, setSiteSearchQuery] = useState("");
  const [siteSearchStatus, setSiteSearchStatus] = useState("");
  const [siteSearchResults, setSiteSearchResults] = useState<GeocodeResult[]>([]);
  const [siteSearchPickBusyId, setSiteSearchPickBusyId] = useState<string | null>(null);
  const [siteSearchBusy, setSiteSearchBusy] = useState(false);

  // ─── Simulation-specific ─────────────────────────────────────────────────────
  const [pendingVisibilityConfirm, setPendingVisibilityConfirm] = useState<{
    simulationId: string;
    targetVisibility: "shared";
    referencedPrivateSiteIds: string[];
  } | null>(null);
  const [simulationFrequencyPresetId, setSimulationFrequencyPresetId] = useState("");
  const [simulationAutoPropagationEnvironment, setSimulationAutoPropagationEnvironment] = useState(true);

  // ─── Link drafts ──────────────────────────────────────────────────────────────
  const [linkNameDraft, setLinkNameDraft] = useState("");
  const [linkFromSiteId, setLinkFromSiteId] = useState("");
  const [linkToSiteId, setLinkToSiteId] = useState("");
  const [overrideRadio, setOverrideRadio] = useState(false);
  const [linkTxPower, setLinkTxPower] = useState(STANDARD_SITE_RADIO.txPowerDbm);
  const [linkTxGain, setLinkTxGain] = useState(STANDARD_SITE_RADIO.txGainDbi);
  const [linkRxGain, setLinkRxGain] = useState(STANDARD_SITE_RADIO.rxGainDbi);
  const [linkCableLoss, setLinkCableLoss] = useState(STANDARD_SITE_RADIO.cableLossDb);

  // ─── Initialize drafts when editor opens ─────────────────────────────────────
  useEffect(() => {
    if (!mapEditor) return;
    setStatus("");
    setPendingVisibilityConfirm(null);
    setIsElevationUserSet(false);

    if (mapEditor.kind === "site") {
      if (mapEditor.isNew) {
        const seed = mapEditor.siteSeed;
        // New site: initialise from map center
        setNameDraft(seed?.name ?? "");
        setDescriptionDraft("");
        setLatDraft(seed?.lat ?? mapViewport?.center.lat ?? 0);
        setLonDraft(seed?.lon ?? mapViewport?.center.lon ?? 0);
        setGroundDraft(0);
        setAntennaDraft(10);
        setTxPowerDraft(STANDARD_SITE_RADIO.txPowerDbm);
        setTxGainDraft(STANDARD_SITE_RADIO.txGainDbi);
        setRxGainDraft(STANDARD_SITE_RADIO.rxGainDbi);
        setSeparateGain(false);
        setCableLossDraft(STANDARD_SITE_RADIO.cableLossDb);
        setAccessVisibility("private");
        setCollaboratorUserIds([]);
        setCollaboratorRoles({});
        setSiteSourceMeta(seed?.sourceMeta);
        setInsertSiteAfterSave(Boolean(seed?.insertIntoSimulation));
        setSiteSearchQuery("");
        setSiteSearchResults([]);
        setSiteSearchStatus("");
      } else {
        // Edit site
        const entry = siteLibrary.find((e) => e.id === mapEditor.resourceId);
        setNameDraft(entry?.name ?? mapEditor.label);
        setDescriptionDraft(entry?.description ?? "");
        setLatDraft(entry?.position.lat ?? 0);
        setLonDraft(entry?.position.lon ?? 0);
        setGroundDraft(entry?.groundElevationM ?? 0);
        setAntennaDraft(entry?.antennaHeightM ?? 2);
        setTxPowerDraft(entry?.txPowerDbm ?? STANDARD_SITE_RADIO.txPowerDbm);
        const nextTxGain = entry?.txGainDbi ?? STANDARD_SITE_RADIO.txGainDbi;
        const nextRxGain = entry?.rxGainDbi ?? STANDARD_SITE_RADIO.rxGainDbi;
        setTxGainDraft(nextTxGain);
        setRxGainDraft(nextRxGain);
        setSeparateGain(shouldUseSeparateSiteGain(nextTxGain, nextRxGain));
        setCableLossDraft(entry?.cableLossDb ?? STANDARD_SITE_RADIO.cableLossDb);
        setAccessVisibility(toAccessVisibility(entry?.visibility) as AccessVisibility);
        const grants = (entry?.sharedWith ?? []).filter((g) => g.userId !== entry?.ownerUserId);
        setCollaboratorUserIds(grants.map((g) => g.userId));
        setCollaboratorRoles(
          Object.fromEntries(
            grants.map((g) => [g.userId, g.role === "editor" || g.role === "admin" ? "editor" : "viewer"]),
          ),
        );
        setSiteSourceMeta(undefined);
        setInsertSiteAfterSave(false);
        setSiteSearchQuery("");
        setSiteSearchResults([]);
        setSiteSearchStatus("");
      }
    } else if (mapEditor.kind === "simulation") {
      if (mapEditor.isNew) {
        setNameDraft("");
        setDescriptionDraft("");
        setAccessVisibility("private");
        setCollaboratorUserIds([]);
        setCollaboratorRoles({});
        setSimulationFrequencyPresetId(mapEditor.simulationSeed?.frequencyPresetId ?? selectedFrequencyPresetId);
        setSimulationAutoPropagationEnvironment(
          mapEditor.simulationSeed?.autoPropagationEnvironment ?? autoPropagationEnvironment,
        );
      } else {
        const preset = simulationPresets.find((p) => p.id === mapEditor.resourceId);
        setNameDraft(preset?.name ?? mapEditor.label);
        setDescriptionDraft(preset?.description ?? "");
        setAccessVisibility(toAccessVisibility(preset?.visibility) as AccessVisibility);
        setSimulationFrequencyPresetId(preset?.snapshot.selectedFrequencyPresetId ?? selectedFrequencyPresetId);
        setSimulationAutoPropagationEnvironment(preset?.snapshot.autoPropagationEnvironment ?? autoPropagationEnvironment);
        const grants = (preset?.sharedWith ?? []).filter((g) => g.userId !== preset?.ownerUserId);
        setCollaboratorUserIds(grants.map((g) => g.userId));
        setCollaboratorRoles(
          Object.fromEntries(
            grants.map((g) => [g.userId, g.role === "editor" || g.role === "admin" ? "editor" : "viewer"]),
          ),
        );
      }
    } else if (mapEditor.kind === "link") {
      if (mapEditor.isNew) {
        const fallbackFrom = sites[0]?.id ?? "";
        const fallbackTo = sites.find((s) => s.id !== fallbackFrom)?.id ?? "";
        const fromSite = sites.find((s) => s.id === fallbackFrom) ?? null;
        const toSite = sites.find((s) => s.id === fallbackTo) ?? null;
        const baseRadio = resolveLinkRadio({} as any, fromSite, toSite);
        setLinkNameDraft("");
        setLinkFromSiteId(fallbackFrom);
        setLinkToSiteId(fallbackTo);
        setOverrideRadio(false);
        setLinkTxPower(baseRadio.txPowerDbm);
        setLinkTxGain(baseRadio.txGainDbi);
        setLinkRxGain(baseRadio.rxGainDbi);
        setLinkCableLoss(baseRadio.cableLossDb);
      } else {
        const link = links.find((l) => l.id === mapEditor.resourceId);
        const fromSite = sites.find((s) => s.id === link?.fromSiteId) ?? null;
        const toSite = sites.find((s) => s.id === link?.toSiteId) ?? null;
        const baseRadio = resolveLinkRadio(link as any, fromSite, toSite);
        const hasOverrides = Boolean(
          link &&
            (typeof link.txPowerDbm === "number" ||
              typeof link.txGainDbi === "number" ||
              typeof link.rxGainDbi === "number" ||
              typeof link.cableLossDb === "number"),
        );
        setLinkNameDraft(link?.name ?? "");
        setLinkFromSiteId(link?.fromSiteId ?? "");
        setLinkToSiteId(link?.toSiteId ?? "");
        setOverrideRadio(hasOverrides);
        setLinkTxPower(baseRadio.txPowerDbm);
        setLinkTxGain(baseRadio.txGainDbi);
        setLinkRxGain(baseRadio.rxGainDbi);
        setLinkCableLoss(baseRadio.cableLossDb);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapEditor?.kind, mapEditor?.resourceId, mapEditor?.isNew]);

  // ─── Terrain prefetch for site coordinates ────────────────────────────────────
  useEffect(() => {
    if (mapEditor?.kind !== "site") return;
    setIsElevationUserSet(false);
    const timer = setTimeout(() => {
      void loadTerrainForCoordinate(latDraft, lonDraft);
    }, 500);
    return () => clearTimeout(timer);
  }, [latDraft, lonDraft, mapEditor?.kind, loadTerrainForCoordinate]);

  // Auto-fill elevation from terrain when it loads (only if user hasn't manually set)
  useEffect(() => {
    if (mapEditor?.kind !== "site" || isElevationUserSet) return;
    const elevation = Number(sampleSrtmElevation(srtmTiles, latDraft, lonDraft));
    if (Number.isFinite(elevation)) setGroundDraft(Math.round(elevation));
  }, [srtmTiles, isElevationUserSet, latDraft, lonDraft, mapEditor?.kind]);

  // ─── Collaborator directory ───────────────────────────────────────────────────
  useEffect(() => {
    if (!mapEditor) return;
    let canceled = false;
    setCollaboratorDirectoryBusy(true);
    setCollaboratorDirectoryStatus("");
    void fetchCollaboratorDirectory()
      .then((users) => {
        if (canceled) return;
        setCollaboratorDirectory(users);
      })
      .catch((error) => {
        if (canceled) return;
        setCollaboratorDirectoryStatus(`Collaborator lookup unavailable: ${getUiErrorMessage(error)}`);
      })
      .finally(() => {
        if (canceled) return;
        setCollaboratorDirectoryBusy(false);
      });
    return () => {
      canceled = true;
    };
  }, [mapEditor?.kind, mapEditor?.resourceId]);

  // ─── Derived values ───────────────────────────────────────────────────────────
  const currentUser_id = currentUser?.id ?? "";
  const ownerUserId = (() => {
    if (!mapEditor) return "";
    if (mapEditor.kind === "site" && mapEditor.resourceId) {
      return siteLibrary.find((e) => e.id === mapEditor.resourceId)?.ownerUserId ?? "";
    }
    if (mapEditor.kind === "simulation" && mapEditor.resourceId) {
      return (simulationPresets.find((p) => p.id === mapEditor.resourceId) as any)?.ownerUserId ?? "";
    }
    return currentUser_id;
  })();

  const canWrite = (() => {
    if (!mapEditor) return false;
    if (mapEditor.isNew) return Boolean(currentUser);
    if (mapEditor.kind === "site" && mapEditor.resourceId) {
      const entry = siteLibrary.find((e) => e.id === mapEditor.resourceId);
      const role = (entry as any)?.effectiveRole ?? "owner";
      return ["owner", "editor", "admin"].includes(role);
    }
    if (mapEditor.kind === "simulation" && mapEditor.resourceId) {
      const preset = simulationPresets.find((p) => p.id === mapEditor.resourceId);
      const role = (preset as any)?.effectiveRole ?? "owner";
      return ["owner", "editor", "admin"].includes(role);
    }
    if (mapEditor.kind === "link") return Boolean(currentUser);
    return false;
  })();

  const collaborators = collaboratorUserIds.map((userId) => {
    const dirUser = collaboratorDirectory.find((u) => u.id === userId);
    return {
      id: userId,
      username: dirUser?.username ?? userId,
      email: dirUser?.email ?? "",
      avatarUrl: dirUser?.avatarUrl ?? "",
      role: collaboratorRoles[userId] ?? "viewer" as AccessRole,
    };
  });

  // ─── Collaborator callbacks ───────────────────────────────────────────────────
  const addCollaborator = (userId: string) => {
    if (!userId.trim()) return;
    if (userId === ownerUserId) {
      setStatus("Owner is implicit and cannot be added as collaborator.");
      return;
    }
    setCollaboratorUserIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    setCollaboratorRoles((prev) => (prev[userId] ? prev : { ...prev, [userId]: "viewer" }));
  };

  const removeCollaborator = (userId: string) => {
    setCollaboratorUserIds((prev) => prev.filter((id) => id !== userId));
    setCollaboratorRoles((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  };

  const setCollaboratorRole = (userId: string, role: AccessRole) => {
    setCollaboratorRoles((prev) => ({ ...prev, [userId]: role }));
  };

  // ─── Terrain fetch helper ─────────────────────────────────────────────────────
  const fetchGroundElevation = (): number | null => {
    const elevation = Number(sampleSrtmElevation(srtmTiles, latDraft, lonDraft));
    if (!Number.isFinite(elevation)) return null;
    return Math.round(elevation);
  };

  const runSiteSearch = async () => {
    if (siteSearchQuery.trim().length < 3) {
      setSiteSearchResults([]);
      setSiteSearchStatus("Enter at least 3 characters to search.");
      return;
    }
    setSiteSearchBusy(true);
    setSiteSearchStatus("Searching...");
    try {
      const results = await searchLocations(siteSearchQuery);
      setSiteSearchResults(results);
      setSiteSearchStatus(results.length ? `Found ${results.length} result(s)` : "No results");
    } catch (error) {
      setSiteSearchStatus(`Search failed: ${getUiErrorMessage(error)}`);
    } finally {
      setSiteSearchBusy(false);
    }
  };

  const selectSiteSearchResult = async (result: GeocodeResult) => {
    setSiteSearchPickBusyId(result.id);
    setSiteSearchStatus("Resolving elevation for selected result...");
    setLatDraft(result.lat);
    setLonDraft(result.lon);
    setIsElevationUserSet(false);
    updateMapViewport({
      center: { lat: result.lat, lon: result.lon },
      zoom: 12,
    });
    try {
      const [elevation] = await fetchElevations([{ lat: result.lat, lon: result.lon }]);
      if (Number.isFinite(elevation)) {
        setGroundDraft(Math.round(elevation));
        setSiteSearchStatus(`Selected: ${result.label} (elevation ${Math.round(elevation)} m)`);
      } else {
        setSiteSearchStatus(`Selected: ${result.label} (elevation unavailable)`);
      }
    } catch (error) {
      setSiteSearchStatus(`Selected coordinates, elevation lookup failed: ${getUiErrorMessage(error)}`);
    } finally {
      setSiteSearchPickBusyId(null);
    }
  };

  // ─── Gain toggle ─────────────────────────────────────────────────────────────
  const handleGainChange = (value: number) => {
    const next = getSyncedSiteGainPair(value);
    setTxGainDraft(next.txGainDbi);
    setRxGainDraft(next.rxGainDbi);
  };

  const handleSeparateGainToggle = (checked: boolean) => {
    setSeparateGain(checked);
    if (!checked) {
      const next = collapseSiteGainToTx(txGainDraft);
      setTxGainDraft(next.txGainDbi);
      setRxGainDraft(next.rxGainDbi);
    }
  };

  // ─── Save handlers ─────────────────────────────────────────────────────────────
  const handleSaveSite = (): boolean => {
    const trimmedName = nameDraft.trim();
    if (!trimmedName) {
      setStatus("Name is required.");
      return false;
    }
    const normalizedVisibility: "private" | "shared" = accessVisibility;
    const sharedWith = collaboratorUserIds
      .filter((id) => id !== ownerUserId)
      .map((id) => ({ userId: id, role: (collaboratorRoles[id] ?? "viewer") as "viewer" | "editor" }));

    try {
      if (mapEditor?.isNew) {
        const createdId = addSiteLibraryEntry(
          trimmedName,
          latDraft,
          lonDraft,
          groundDraft,
          antennaDraft,
          txPowerDraft,
          txGainDraft,
          rxGainDraft,
          cableLossDraft,
          siteSourceMeta,
          normalizedVisibility,
          descriptionDraft.trim() || undefined,
        );
        if (sharedWith.length) {
          updateSiteLibraryEntry(createdId, { sharedWith });
        }
        if (insertSiteAfterSave) {
          insertSiteFromLibrary(createdId);
        }
      } else if (mapEditor?.resourceId) {
        updateSiteLibraryEntry(mapEditor.resourceId, {
          name: trimmedName,
          description: descriptionDraft.trim() || undefined,
          position: { lat: latDraft, lon: lonDraft },
          groundElevationM: groundDraft,
          antennaHeightM: antennaDraft,
          txPowerDbm: txPowerDraft,
          txGainDbi: txGainDraft,
          rxGainDbi: rxGainDraft,
          cableLossDb: cableLossDraft,
          visibility: normalizedVisibility,
          sharedWith,
        });
      }
      closeMapEditor();
      return true;
    } catch (error) {
      setStatus(`Save failed: ${getUiErrorMessage(error)}`);
      return false;
    }
  };

  const handleSaveSimulation = (): boolean => {
    const trimmedName = nameDraft.trim();
    if (!trimmedName) {
      setStatus("Name is required.");
      return false;
    }
    const normalizedVisibility: "private" | "shared" = accessVisibility;
    const sharedWith = collaboratorUserIds
      .filter((id) => id !== ownerUserId)
      .map((id) => ({ userId: id, role: (collaboratorRoles[id] ?? "viewer") as "viewer" | "editor" }));

    if (mapEditor?.isNew) {
      if (!currentUser?.id) {
        setStatus("Cannot create simulation until current user profile is loaded.");
        return false;
      }
      try {
        const createdId = createBlankSimulationPreset(trimmedName, {
          frequencyPresetId: simulationFrequencyPresetId,
          description: descriptionDraft.trim() || undefined,
          visibility: normalizedVisibility,
          autoPropagationEnvironment: simulationAutoPropagationEnvironment,
          ownerUserId: currentUser.id,
          createdByUserId: currentUser.id,
          createdByName: currentUser.username,
          createdByAvatarUrl: currentUser.avatarUrl ?? "",
          lastEditedByUserId: currentUser.id,
          lastEditedByName: currentUser.username,
          lastEditedByAvatarUrl: currentUser.avatarUrl ?? "",
        });
        if (!createdId) {
          setStatus("Failed creating simulation. Check the name and try again.");
          return false;
        }
        if (sharedWith.length) {
          updateSimulationPresetEntry(createdId, { sharedWith });
        }
        loadSimulationPreset(createdId);
        closeMapEditor();
        return true;
      } catch (error) {
        setStatus(`Save failed: ${getUiErrorMessage(error)}`);
        return false;
      }
    }

    if (!mapEditor?.resourceId) return false;

    // Check for private site refs that would need to be promoted
    if (normalizedVisibility === "shared") {
      const preset = simulationPresets.find((p) => p.id === mapEditor.resourceId);
      const referencedPrivateSiteIds = siteLibrary
        .filter((entry) => {
          if ((entry.visibility ?? "private") !== "private") return false;
          const refIds = new Set(
            (preset?.snapshot.sites ?? [])
              .map((s) => s.libraryEntryId)
              .filter((v): v is string => typeof v === "string" && v.length > 0),
          );
          return refIds.has(entry.id);
        })
        .map((e) => e.id);
      if (referencedPrivateSiteIds.length > 0) {
        setPendingVisibilityConfirm({
          simulationId: mapEditor.resourceId,
          targetVisibility: "shared",
          referencedPrivateSiteIds,
        });
        return false;
      }
    }

    try {
      updateSimulationPresetEntry(mapEditor.resourceId, {
        name: trimmedName,
        description: descriptionDraft.trim() || undefined,
        visibility: normalizedVisibility,
        sharedWith,
      });
      closeMapEditor();
      return true;
    } catch (error) {
      setStatus(`Save failed: ${getUiErrorMessage(error)}`);
      return false;
    }
  };

  const applyPendingVisibilityChange = () => {
    if (!pendingVisibilityConfirm || !mapEditor?.resourceId) return;
    for (const siteId of pendingVisibilityConfirm.referencedPrivateSiteIds) {
      updateSiteLibraryEntry(siteId, { visibility: pendingVisibilityConfirm.targetVisibility });
    }
    const sharedWith = collaboratorUserIds
      .filter((id) => id !== ownerUserId)
      .map((id) => ({ userId: id, role: (collaboratorRoles[id] ?? "viewer") as "viewer" | "editor" }));
    updateSimulationPresetEntry(pendingVisibilityConfirm.simulationId, {
      visibility: pendingVisibilityConfirm.targetVisibility,
      sharedWith,
    });
    setPendingVisibilityConfirm(null);
    closeMapEditor();
  };

  const handleSaveLink = (): boolean => {
    const fromExists = sites.some((s) => s.id === linkFromSiteId);
    const toExists = sites.some((s) => s.id === linkToSiteId);
    if (!fromExists || !toExists) {
      setStatus("From/To must be valid current simulation sites.");
      return false;
    }
    if (!linkFromSiteId || !linkToSiteId) {
      setStatus("Select both From and To sites.");
      return false;
    }
    if (linkFromSiteId === linkToSiteId) {
      setStatus("From and To must be different sites.");
      return false;
    }
    try {
      if (mapEditor?.isNew) {
        createLink(linkFromSiteId, linkToSiteId, linkNameDraft || undefined);
      } else if (mapEditor?.resourceId) {
        updateLink(mapEditor.resourceId, {
          name: linkNameDraft || undefined,
          fromSiteId: linkFromSiteId,
          toSiteId: linkToSiteId,
          txPowerDbm: overrideRadio ? linkTxPower : undefined,
          txGainDbi: overrideRadio ? linkTxGain : undefined,
          rxGainDbi: overrideRadio ? linkRxGain : undefined,
          cableLossDb: overrideRadio ? linkCableLoss : undefined,
        });
      }
      closeMapEditor();
      return true;
    } catch (error) {
      setStatus(`Save failed: ${getUiErrorMessage(error)}`);
      return false;
    }
  };

  return {
    // shared
    status, setStatus,
    nameDraft, setNameDraft,
    descriptionDraft, setDescriptionDraft,
    accessVisibility, setAccessVisibility,
    collaborators,
    collaboratorDirectory,
    collaboratorDirectoryBusy,
    collaboratorDirectoryStatus,
    addCollaborator,
    removeCollaborator,
    setCollaboratorRole,
    ownerUserId,
    canWrite,
    currentUser,
    // site
    latDraft, setLatDraft: (v: number | string) => setLatDraft(parseNumber(String(v))),
    lonDraft, setLonDraft: (v: number | string) => setLonDraft(parseNumber(String(v))),
    groundDraft, setGroundDraft: (v: number | string) => { setGroundDraft(parseNumber(String(v))); setIsElevationUserSet(true); },
    antennaDraft, setAntennaDraft: (v: number | string) => setAntennaDraft(parseNumber(String(v))),
    txPowerDraft, setTxPowerDraft: (v: number | string) => setTxPowerDraft(parseNumber(String(v))),
    txGainDraft, setTxGainDraft: (v: number | string) => setTxGainDraft(parseNumber(String(v))),
    rxGainDraft, setRxGainDraft: (v: number | string) => setRxGainDraft(parseNumber(String(v))),
    separateGain,
    cableLossDraft, setCableLossDraft: (v: number | string) => setCableLossDraft(parseNumber(String(v))),
    isEditorTerrainFetching,
    fetchGroundElevation,
    handleGainChange,
    handleSeparateGainToggle,
    handleSaveSite,
    // simulation
    pendingVisibilityConfirm,
    setPendingVisibilityConfirm,
    applyPendingVisibilityChange,
    simulationFrequencyPresetId,
    setSimulationFrequencyPresetId,
    simulationAutoPropagationEnvironment,
    setSimulationAutoPropagationEnvironment,
    handleSaveSimulation,
    // link
    linkNameDraft, setLinkNameDraft,
    linkFromSiteId, setLinkFromSiteId,
    linkToSiteId, setLinkToSiteId,
    overrideRadio, setOverrideRadio,
    linkTxPower, setLinkTxPower: (v: number | string) => setLinkTxPower(parseNumber(String(v))),
    linkTxGain, setLinkTxGain: (v: number | string) => setLinkTxGain(parseNumber(String(v))),
    linkRxGain, setLinkRxGain: (v: number | string) => setLinkRxGain(parseNumber(String(v))),
    linkCableLoss, setLinkCableLoss: (v: number | string) => setLinkCableLoss(parseNumber(String(v))),
    handleSaveLink,
    siteSearchQuery,
    setSiteSearchQuery,
    siteSearchStatus,
    siteSearchResults,
    siteSearchBusy,
    siteSearchPickBusyId,
    runSiteSearch,
    selectSiteSearchResult,
    // raw data for labels
    sites,
  };
}
