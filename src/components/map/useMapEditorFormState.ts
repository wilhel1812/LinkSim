import { useEffect, useState } from "react";
import { collapseSiteGainToTx, getSyncedSiteGainPair, shouldUseSeparateSiteGain } from "../../lib/siteGainFields";
import { resolveLinkRadio, STANDARD_SITE_RADIO } from "../../lib/linkRadio";
import { toAccessVisibility } from "../../lib/uiFormatting";
import { normalizeSimulationDefaults, resolveUserSimulationDefaults, type SimulationDefaults } from "../../lib/simulationDefaults";
import { fetchCollaboratorDirectory } from "../../lib/cloudUser";
import { fetchElevations } from "../../lib/elevationService";
import { searchLocations, type GeocodeResult } from "../../lib/geocode";
import { sampleSrtmElevation } from "../../lib/srtm";
import { getUiErrorMessage } from "../../lib/uiError";
import { hasDuplicateSimulationNameForOwner } from "../../lib/simulationNameValidation";
import { isSiteIconKey, type SiteIconKey } from "../../lib/siteIcons";
import {
  DEFAULT_LINK_COLOR_MODE,
  normalizeLinkColorMode,
  normalizeSimulationColor,
  normalizeSiteIconColors,
  type LinkColorMode,
} from "../../lib/simulationColors";
import { useAppStore } from "../../store/appStore";
import type { CollaboratorDirectoryUser } from "../../lib/cloudUser";
import type { AccessRole, AccessVisibility } from "../AccessSettingsEditor";

const parseNumber = (value: string | number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

type CoordinateDraft = string | number;

const parseCoordinateDraft = (value: CoordinateDraft): number | null => {
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const validateLatitude = (value: CoordinateDraft): { value: number | null; error: string | null } => {
  const parsed = parseCoordinateDraft(value);
  if (parsed === null) return { value: null, error: "Latitude must be a number." };
  if (parsed < -90 || parsed > 90) return { value: parsed, error: "Latitude must be between -90 and 90." };
  return { value: parsed, error: null };
};

const validateLongitude = (value: CoordinateDraft): { value: number | null; error: string | null } => {
  const parsed = parseCoordinateDraft(value);
  if (parsed === null) return { value: null, error: "Longitude must be a number." };
  if (parsed < -180 || parsed > 180) return { value: parsed, error: "Longitude must be between -180 and 180." };
  return { value: parsed, error: null };
};

export function useMapEditorFormState() {
  const mapEditor = useAppStore((state) => state.mapEditor);
  const mapEditorSiteDraft = useAppStore((state) => state.mapEditorSiteDraft);
  const closeMapEditor = useAppStore((state) => state.closeMapEditor);
  const setMapEditorSiteDraft = useAppStore((state) => state.setMapEditorSiteDraft);
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
  const createSimulationCopyFromCurrent = useAppStore((state) => state.createSimulationCopyFromCurrent);
  const loadSimulationPreset = useAppStore((state) => state.loadSimulationPreset);
  const selectedFrequencyPresetId = useAppStore((state) => state.selectedFrequencyPresetId);
  const autoPropagationEnvironment = useAppStore((state) => state.autoPropagationEnvironment);
  const activeLinkColorMode = useAppStore((state) => state.linkColorMode);
  const activeSiteIconColors = useAppStore((state) => state.siteIconColors);
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
  const [latDraft, setLatDraft] = useState<CoordinateDraft>(0);
  const [lonDraft, setLonDraft] = useState<CoordinateDraft>(0);
  const [latError, setLatError] = useState<string | null>(null);
  const [lonError, setLonError] = useState<string | null>(null);
  const [groundDraft, setGroundDraft] = useState(0);
  const [antennaDraft, setAntennaDraft] = useState(2);
  const [iconDraft, setIconDraft] = useState<"auto" | SiteIconKey>("auto");
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
  const [simulationFrequencyPresetId, setSimulationFrequencyPresetId] = useState("");
  const [simulationAutoPropagationEnvironment, setSimulationAutoPropagationEnvironment] = useState(true);
  const [simulationDefaultsOverrideEnabled, setSimulationDefaultsOverrideEnabled] = useState(false);
  const [simulationDefaultsDraft, setSimulationDefaultsDraft] = useState<SimulationDefaults>(() =>
    normalizeSimulationDefaults(null),
  );
  const [simulationNameError, setSimulationNameError] = useState("");
  const [simulationLinkColorMode, setSimulationLinkColorMode] = useState<LinkColorMode>(DEFAULT_LINK_COLOR_MODE);
  const [simulationSiteIconColors, setSimulationSiteIconColors] = useState<Record<string, string>>({});

  const setDuplicateSimulationNameError = () => setSimulationNameError("Name must be unique.");

  // ─── Link drafts ──────────────────────────────────────────────────────────────
  const [linkNameDraft, setLinkNameDraft] = useState("");
  const [linkFromSiteId, setLinkFromSiteId] = useState("");
  const [linkToSiteId, setLinkToSiteId] = useState("");
  const [overrideRadio, setOverrideRadio] = useState(false);
  const [linkTxPower, setLinkTxPower] = useState(STANDARD_SITE_RADIO.txPowerDbm);
  const [linkTxGain, setLinkTxGain] = useState(STANDARD_SITE_RADIO.txGainDbi);
  const [linkRxGain, setLinkRxGain] = useState(STANDARD_SITE_RADIO.rxGainDbi);
  const [linkCableLoss, setLinkCableLoss] = useState(STANDARD_SITE_RADIO.cableLossDb);
  const [linkColorDraft, setLinkColorDraft] = useState<string | null>(null);

  const getLinkDefaultName = (fromId: string, toId: string): string => {
    const from = sites.find((site) => site.id === fromId);
    const to = sites.find((site) => site.id === toId);
    return from && to ? `${from.name} -> ${to.name}` : "";
  };

  // ─── Initialize drafts when editor opens ─────────────────────────────────────
  useEffect(() => {
    if (!mapEditor) return;
    setStatus("");
    setIsElevationUserSet(false);

    if (mapEditor.kind === "site") {
      setLatError(null);
      setLonError(null);
      if (mapEditor.isNew) {
        const seed = mapEditor.siteSeed;
        const seededLat = seed?.lat ?? mapViewport?.center.lat ?? 0;
        const seededLon = seed?.lon ?? mapViewport?.center.lon ?? 0;
        const shouldPlacePin = typeof seed?.lat === "number" && typeof seed?.lon === "number" && !seed.awaitMapClick;
        setNameDraft(seed?.name ?? "");
        setDescriptionDraft("");
        setLatDraft(seededLat);
        setLonDraft(seededLon);
        setGroundDraft(0);
        setAntennaDraft(10);
        setIconDraft("auto");
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
        setSiteSearchStatus(shouldPlacePin ? "" : "Click the map to choose this site's coordinates.");
        setMapEditorSiteDraft(shouldPlacePin ? { lat: seededLat, lon: seededLon, groundElevationM: null } : null);
      } else {
        // Edit site
        const entry = siteLibrary.find((e) => e.id === mapEditor.resourceId);
        const entryLat = entry?.position.lat ?? 0;
        const entryLon = entry?.position.lon ?? 0;
        const entryGround = entry?.groundElevationM ?? 0;
        setNameDraft(entry?.name ?? mapEditor.label);
        setDescriptionDraft(entry?.description ?? "");
        setLatDraft(entryLat);
        setLonDraft(entryLon);
        setGroundDraft(entryGround);
        setAntennaDraft(entry?.antennaHeightM ?? 2);
        setIconDraft(isSiteIconKey(entry?.iconKey) ? entry.iconKey : "auto");
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
        setMapEditorSiteDraft({ lat: entryLat, lon: entryLon, groundElevationM: entryGround });
      }
    } else if (mapEditor.kind === "simulation") {
      if (mapEditor.isNew) {
        const seed = mapEditor.simulationSeed;
        setNameDraft(seed?.name ?? "");
        setDescriptionDraft(seed?.description ?? "");
        setAccessVisibility("private");
        setCollaboratorUserIds([]);
        setCollaboratorRoles({});
        setSimulationFrequencyPresetId(seed?.frequencyPresetId ?? selectedFrequencyPresetId);
        setSimulationAutoPropagationEnvironment(seed?.autoPropagationEnvironment ?? autoPropagationEnvironment);
        setSimulationLinkColorMode(seed?.copyCurrentSimulation ? activeLinkColorMode : DEFAULT_LINK_COLOR_MODE);
        setSimulationSiteIconColors(seed?.copyCurrentSimulation ? activeSiteIconColors : {});
        if (seed?.copyCurrentSimulation) {
          setSimulationDefaultsOverrideEnabled(Boolean(seed.simulationDefaultsOverrideEnabled));
          setSimulationDefaultsDraft(
            seed.simulationDefaultsOverride
              ? normalizeSimulationDefaults(seed.simulationDefaultsOverride)
              : resolveUserSimulationDefaults(currentUser?.simulationDefaultsPreference, currentUser?.defaultFrequencyPresetId),
          );
        } else {
          const inherited = resolveUserSimulationDefaults(currentUser?.simulationDefaultsPreference, currentUser?.defaultFrequencyPresetId);
          setSimulationDefaultsOverrideEnabled(false);
          setSimulationDefaultsDraft(inherited);
        }
      } else {
        const preset = simulationPresets.find((p) => p.id === mapEditor.resourceId);
        setNameDraft(preset?.name ?? mapEditor.label);
        setDescriptionDraft(preset?.description ?? "");
        setAccessVisibility(toAccessVisibility(preset?.visibility) as AccessVisibility);
        setSimulationFrequencyPresetId(preset?.snapshot.selectedFrequencyPresetId ?? selectedFrequencyPresetId);
        setSimulationAutoPropagationEnvironment(preset?.snapshot.autoPropagationEnvironment ?? autoPropagationEnvironment);
        setSimulationLinkColorMode(normalizeLinkColorMode(preset?.snapshot.linkColorMode));
        setSimulationSiteIconColors(normalizeSiteIconColors(
          preset?.snapshot.siteIconColors,
          (preset?.snapshot.sites ?? []).map((site) => site.id),
        ));
        setSimulationDefaultsOverrideEnabled(Boolean(preset?.snapshot.simulationDefaultsOverrideEnabled));
        setSimulationDefaultsDraft(
          preset?.snapshot.simulationDefaultsOverride
            ? normalizeSimulationDefaults(preset.snapshot.simulationDefaultsOverride)
            : resolveUserSimulationDefaults(currentUser?.simulationDefaultsPreference, currentUser?.defaultFrequencyPresetId),
        );
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
        setLinkFromSiteId(fallbackFrom);
        setLinkToSiteId(fallbackTo);
        setLinkNameDraft(getLinkDefaultName(fallbackFrom, fallbackTo));
        setOverrideRadio(false);
        setLinkTxPower(baseRadio.txPowerDbm);
        setLinkTxGain(baseRadio.txGainDbi);
        setLinkRxGain(baseRadio.rxGainDbi);
        setLinkCableLoss(baseRadio.cableLossDb);
        setLinkColorDraft(null);
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
        setLinkFromSiteId(link?.fromSiteId ?? "");
        setLinkToSiteId(link?.toSiteId ?? "");
        setLinkNameDraft(link?.name ?? getLinkDefaultName(link?.fromSiteId ?? "", link?.toSiteId ?? ""));
        setOverrideRadio(hasOverrides);
        setLinkTxPower(baseRadio.txPowerDbm);
        setLinkTxGain(baseRadio.txGainDbi);
        setLinkRxGain(baseRadio.rxGainDbi);
        setLinkCableLoss(baseRadio.cableLossDb);
        setLinkColorDraft(normalizeSimulationColor(link?.color));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapEditor?.kind, mapEditor?.resourceId, mapEditor?.isNew]);

  useEffect(() => {
    if (mapEditor?.kind !== "simulation") {
      setSimulationNameError("");
      return;
    }
    const trimmedName = nameDraft.trim();
    if (!trimmedName || !currentUser?.id) {
      setSimulationNameError("");
      return;
    }
    const timer = window.setTimeout(() => {
      const isDuplicate = hasDuplicateSimulationNameForOwner(
        simulationPresets,
        trimmedName,
        currentUser.id,
        mapEditor.isNew ? undefined : mapEditor.resourceId ?? undefined,
      );
      setSimulationNameError(isDuplicate ? "Name must be unique." : "");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [currentUser?.id, mapEditor?.isNew, mapEditor?.kind, mapEditor?.resourceId, nameDraft, simulationPresets]);

  useEffect(() => {
    if (mapEditor?.kind !== "site" || !mapEditorSiteDraft) return;
    setLatDraft((current) => (current === mapEditorSiteDraft.lat ? current : mapEditorSiteDraft.lat));
    setLonDraft((current) => (current === mapEditorSiteDraft.lon ? current : mapEditorSiteDraft.lon));
    if (typeof mapEditorSiteDraft.groundElevationM === "number") {
      const nextGround = mapEditorSiteDraft.groundElevationM;
      setGroundDraft((current) => (current === nextGround ? current : nextGround));
    }
    if (mapEditor.isNew) setSiteSearchStatus("");
  }, [mapEditor?.kind, mapEditor?.isNew, mapEditorSiteDraft]);

  // ─── Terrain prefetch for site coordinates ────────────────────────────────────
  useEffect(() => {
    if (mapEditor?.kind !== "site") return;
    const lat = validateLatitude(latDraft);
    const lon = validateLongitude(lonDraft);
    if (lat.error || lon.error || lat.value === null || lon.value === null) return;
    const nextLat = lat.value;
    const nextLon = lon.value;
    setIsElevationUserSet(false);
    const timer = setTimeout(() => {
      void loadTerrainForCoordinate(nextLat, nextLon);
    }, 500);
    return () => clearTimeout(timer);
  }, [latDraft, lonDraft, mapEditor?.kind, loadTerrainForCoordinate]);

  // Auto-fill elevation from terrain when it loads (only if user hasn't manually set)
  useEffect(() => {
    if (mapEditor?.kind !== "site" || isElevationUserSet) return;
    const lat = validateLatitude(latDraft);
    const lon = validateLongitude(lonDraft);
    if (lat.error || lon.error || lat.value === null || lon.value === null) return;
    const elevation = Number(sampleSrtmElevation(srtmTiles, lat.value, lon.value));
    if (Number.isFinite(elevation)) {
      const roundedElevation = Math.round(elevation);
      setGroundDraft(roundedElevation);
      if (mapEditorSiteDraft) {
        setMapEditorSiteDraft({ lat: lat.value, lon: lon.value, groundElevationM: roundedElevation });
      }
    }
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
  const currentSiteEntry =
    mapEditor?.kind === "site" && mapEditor.resourceId
      ? siteLibrary.find((entry) => entry.id === mapEditor.resourceId) ?? null
      : null;
  const currentSimulationPreset =
    mapEditor?.kind === "simulation" && mapEditor.resourceId
      ? simulationPresets.find((preset) => preset.id === mapEditor.resourceId) ?? null
      : null;
  const ownerUserId = (() => {
    if (!mapEditor) return "";
    if (mapEditor.kind === "site" && mapEditor.resourceId) {
      return currentSiteEntry?.ownerUserId ?? "";
    }
    if (mapEditor.kind === "simulation" && mapEditor.resourceId) {
      return currentSimulationPreset?.ownerUserId ?? "";
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
  const currentUserIsOwner = Boolean(currentUser?.id && ownerUserId && currentUser.id === ownerUserId);
  const resolveUserSummary = (
    userId: string | null | undefined,
    fallbackName: string | null | undefined,
    fallbackAvatarUrl: string | null | undefined,
  ) => {
    const directoryUser = userId ? collaboratorDirectory.find((user) => user.id === userId) : undefined;
    const name =
      directoryUser?.username ||
      (fallbackName && fallbackName.trim() && fallbackName.trim() !== "Unknown" ? fallbackName.trim() : "") ||
      userId ||
      "Unknown";
    return {
      id: userId ?? "",
      name,
      avatarUrl: directoryUser?.avatarUrl || fallbackAvatarUrl || "",
    };
  };
  const siteMetadata =
    mapEditor?.kind === "site" && currentSiteEntry
      ? {
          kind: "site" as const,
          resourceId: currentSiteEntry.id,
          label: currentSiteEntry.name,
          owner: resolveUserSummary(
            currentSiteEntry.ownerUserId,
            currentSiteEntry.createdByName,
            currentSiteEntry.createdByAvatarUrl,
          ),
          lastEditedBy: resolveUserSummary(
            currentSiteEntry.lastEditedByUserId,
            currentSiteEntry.lastEditedByName,
            currentSiteEntry.lastEditedByAvatarUrl,
          ),
        }
      : null;
  const simulationMetadata =
    mapEditor?.kind === "simulation" && currentSimulationPreset
      ? {
          kind: "simulation" as const,
          resourceId: currentSimulationPreset.id,
          label: currentSimulationPreset.name,
          owner: resolveUserSummary(
            currentSimulationPreset.ownerUserId,
            currentSimulationPreset.createdByName,
            currentSimulationPreset.createdByAvatarUrl,
          ),
          lastEditedBy: resolveUserSummary(
            currentSimulationPreset.lastEditedByUserId,
            currentSimulationPreset.lastEditedByName,
            currentSimulationPreset.lastEditedByAvatarUrl,
          ),
        }
      : null;

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
    if (userId === ownerUserId) {
      setStatus("Owner permissions cannot be changed.");
      return;
    }
    if (mapEditor?.kind === "site" && !currentUserIsOwner) {
      setStatus("Only the owner can remove collaborators.");
      return;
    }
    setCollaboratorUserIds((prev) => prev.filter((id) => id !== userId));
    setCollaboratorRoles((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  };

  const setCollaboratorRole = (userId: string, role: AccessRole) => {
    if (userId === ownerUserId) {
      setStatus("Owner permissions cannot be changed.");
      return;
    }
    setCollaboratorRoles((prev) => ({ ...prev, [userId]: role }));
  };

  // ─── Terrain fetch helper ─────────────────────────────────────────────────────
  const fetchGroundElevation = (): number | null => {
    const lat = validateLatitude(latDraft);
    const lon = validateLongitude(lonDraft);
    if (lat.error || lon.error || lat.value === null || lon.value === null) return null;
    const elevation = Number(sampleSrtmElevation(srtmTiles, lat.value, lon.value));
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
    setMapEditorSiteDraft({ lat: result.lat, lon: result.lon, groundElevationM: null });
    try {
      const [elevation] = await fetchElevations([{ lat: result.lat, lon: result.lon }]);
      if (Number.isFinite(elevation)) {
        const roundedElevation = Math.round(elevation);
        setGroundDraft(roundedElevation);
        setMapEditorSiteDraft({ lat: result.lat, lon: result.lon, groundElevationM: roundedElevation });
        setSiteSearchStatus(`Selected: ${result.label} (elevation ${roundedElevation} m)`);
      } else {
        setMapEditorSiteDraft({ lat: result.lat, lon: result.lon, groundElevationM: null });
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
    if (mapEditor?.kind === "site" && !mapEditorSiteDraft) {
      setStatus("Click the map or use search to choose coordinates before saving.");
      return false;
    }
    const latValidation = validateLatitude(latDraft);
    const lonValidation = validateLongitude(lonDraft);
    setLatError(latValidation.error);
    setLonError(lonValidation.error);
    if (latValidation.error || lonValidation.error || latValidation.value === null || lonValidation.value === null) {
      setStatus(latValidation.error ?? lonValidation.error ?? "Coordinates must be valid.");
      return false;
    }
    const normalizedVisibility: "private" | "shared" = accessVisibility;
    if (collaboratorUserIds.includes(ownerUserId)) {
      setStatus("Owner is implicit and cannot be added as collaborator.");
      return false;
    }
    if (mapEditor?.kind === "site" && !mapEditor.isNew && !currentUserIsOwner) {
      const currentSharedUserIds = new Set((currentSiteEntry?.sharedWith ?? []).map((grant) => grant.userId));
      const nextSharedUserIds = new Set(collaboratorUserIds);
      const removedCollaborators = [...currentSharedUserIds].filter((id) => !nextSharedUserIds.has(id));
      if (removedCollaborators.length) {
        setStatus("Only the owner can remove collaborators.");
        return false;
      }
    }
    const sharedWith = collaboratorUserIds
      .filter((id) => id !== ownerUserId)
      .map((id) => ({ userId: id, role: (collaboratorRoles[id] ?? "viewer") as "viewer" | "editor" }));

    try {
      const saveLat = latValidation.value;
      const saveLon = lonValidation.value;
      const saveGround = mapEditorSiteDraft?.groundElevationM ?? groundDraft;
      if (mapEditor?.isNew) {
        const createdId = addSiteLibraryEntry(
          trimmedName,
          saveLat,
          saveLon,
          saveGround,
          antennaDraft,
          txPowerDraft,
          txGainDraft,
          rxGainDraft,
          cableLossDraft,
          siteSourceMeta,
          normalizedVisibility,
          descriptionDraft.trim() || undefined,
          iconDraft === "auto" ? undefined : iconDraft,
        );
        if (!createdId) {
          setStatus("Failed creating site. Check the name and try again.");
          return false;
        }
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
          position: { lat: saveLat, lon: saveLon },
          groundElevationM: saveGround,
          antennaHeightM: antennaDraft,
          txPowerDbm: txPowerDraft,
          txGainDbi: txGainDraft,
          rxGainDbi: rxGainDraft,
          cableLossDb: cableLossDraft,
          iconKey: iconDraft === "auto" ? undefined : iconDraft,
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
      if (hasDuplicateSimulationNameForOwner(simulationPresets, trimmedName, currentUser.id)) {
        setDuplicateSimulationNameError();
        return false;
      }
      try {
        if (mapEditor.simulationSeed?.copyCurrentSimulation) {
          const createdId = createSimulationCopyFromCurrent(trimmedName, {
            description: descriptionDraft.trim() || undefined,
            frequencyPresetId: simulationFrequencyPresetId,
            autoPropagationEnvironment: simulationAutoPropagationEnvironment,
            simulationDefaultsOverrideEnabled,
            simulationDefaultsOverride: simulationDefaultsOverrideEnabled ? simulationDefaultsDraft : null,
            linkColorMode: simulationLinkColorMode,
            siteIconColors: simulationSiteIconColors,
          });
          if (!createdId) {
            setStatus("Failed creating simulation copy. Check the name and try again.");
            return false;
          }
          loadSimulationPreset(createdId);
          closeMapEditor();
          return true;
        }

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
          linkColorMode: simulationLinkColorMode,
          siteIconColors: simulationSiteIconColors,
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

    if (
      currentSimulationPreset &&
      hasDuplicateSimulationNameForOwner(
        simulationPresets,
        trimmedName,
        currentSimulationPreset.ownerUserId ?? "",
        currentSimulationPreset.id,
      )
    ) {
      setDuplicateSimulationNameError();
      return false;
    }

    try {
      updateSimulationPresetEntry(mapEditor.resourceId, {
        name: trimmedName,
        description: descriptionDraft.trim() || undefined,
        visibility: normalizedVisibility,
        sharedWith,
        simulationDefaultsOverrideEnabled,
        simulationDefaultsOverride: simulationDefaultsOverrideEnabled ? simulationDefaultsDraft : null,
        linkColorMode: simulationLinkColorMode,
        siteIconColors: simulationSiteIconColors,
      });
      closeMapEditor();
      return true;
    } catch (error) {
      setStatus(`Save failed: ${getUiErrorMessage(error)}`);
      return false;
    }
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
        createLink(linkFromSiteId, linkToSiteId, linkNameDraft || undefined, linkColorDraft);
      } else if (mapEditor?.resourceId) {
        updateLink(mapEditor.resourceId, {
          name: linkNameDraft || undefined,
          fromSiteId: linkFromSiteId,
          toSiteId: linkToSiteId,
          txPowerDbm: overrideRadio ? linkTxPower : undefined,
          txGainDbi: overrideRadio ? linkTxGain : undefined,
          rxGainDbi: overrideRadio ? linkRxGain : undefined,
          cableLossDb: overrideRadio ? linkCableLoss : undefined,
          color: linkColorDraft ?? undefined,
        });
      }
      closeMapEditor();
      return true;
    } catch (error) {
      setStatus(`Save failed: ${getUiErrorMessage(error)}`);
      return false;
    }
  };

  const setSitePositionDraft = (nextLat: CoordinateDraft, nextLon: CoordinateDraft, nextGround = groundDraft) => {
    const lat = validateLatitude(nextLat);
    const lon = validateLongitude(nextLon);
    setLatDraft(nextLat);
    setLonDraft(nextLon);
    setLatError(lat.error);
    setLonError(lon.error);
    setStatus((current) =>
      current === "Latitude must be a number." ||
      current === "Latitude must be between -90 and 90." ||
      current === "Longitude must be a number." ||
      current === "Longitude must be between -180 and 180."
        ? ""
        : current,
    );
    if (lat.error || lon.error || lat.value === null || lon.value === null) return;
    setMapEditorSiteDraft({ lat: lat.value, lon: lon.value, groundElevationM: nextGround });
  };

  const setLinkFromSiteIdWithName = (nextFrom: string) => {
    const fallbackTo = linkToSiteId === nextFrom ? sites.find((site) => site.id !== nextFrom)?.id ?? "" : linkToSiteId;
    setLinkFromSiteId(nextFrom);
    setLinkToSiteId(fallbackTo);
    if (mapEditor?.isNew) {
      setLinkNameDraft(getLinkDefaultName(nextFrom, fallbackTo));
    }
  };

  const setLinkToSiteIdWithName = (nextTo: string) => {
    setLinkToSiteId(nextTo);
    if (mapEditor?.isNew) {
      setLinkNameDraft(getLinkDefaultName(linkFromSiteId, nextTo));
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
    currentUserIsOwner,
    siteMetadata,
    simulationMetadata,
    canWrite,
    currentUser,
    // site
    latDraft,
    lonDraft,
    latError,
    lonError,
    setLatDraft: (v: number | string) => setSitePositionDraft(v, lonDraft),
    setLonDraft: (v: number | string) => setSitePositionDraft(latDraft, v),
    groundDraft, setGroundDraft: (v: number | string) => {
      const nextGround = parseNumber(String(v));
      setGroundDraft(nextGround);
      if (mapEditorSiteDraft) {
        setMapEditorSiteDraft({ ...mapEditorSiteDraft, groundElevationM: nextGround });
      }
      setIsElevationUserSet(true);
    },
    antennaDraft, setAntennaDraft: (v: number | string) => setAntennaDraft(parseNumber(String(v))),
    iconDraft, setIconDraft,
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
    simulationFrequencyPresetId,
    setSimulationFrequencyPresetId,
    simulationAutoPropagationEnvironment,
    setSimulationAutoPropagationEnvironment,
    simulationDefaultsOverrideEnabled,
    setSimulationDefaultsOverrideEnabled,
    simulationDefaultsDraft,
    simulationNameError,
    simulationLinkColorMode,
    setSimulationLinkColorMode,
    simulationSiteIconColors,
    setSimulationSiteIconColor: (siteId: string, value: string | null) => {
      setSimulationSiteIconColors((current) => {
        const next = { ...current };
        const color = normalizeSimulationColor(value);
        if (color) next[siteId] = color;
        else delete next[siteId];
        return next;
      });
    },
    setSimulationDefaultsDraft: (patch: Partial<SimulationDefaults>) =>
      setSimulationDefaultsDraft((current) => normalizeSimulationDefaults({ ...current, ...patch }, current)),
    handleSaveSimulation,
    // link
    linkNameDraft, setLinkNameDraft,
    linkFromSiteId, setLinkFromSiteId: setLinkFromSiteIdWithName,
    linkToSiteId, setLinkToSiteId: setLinkToSiteIdWithName,
    overrideRadio, setOverrideRadio,
    linkTxPower, setLinkTxPower: (v: number | string) => setLinkTxPower(parseNumber(String(v))),
    linkTxGain, setLinkTxGain: (v: number | string) => setLinkTxGain(parseNumber(String(v))),
    linkRxGain, setLinkRxGain: (v: number | string) => setLinkRxGain(parseNumber(String(v))),
    linkCableLoss, setLinkCableLoss: (v: number | string) => setLinkCableLoss(parseNumber(String(v))),
    linkColorDraft,
    setLinkColorDraft: (value: string | null) => setLinkColorDraft(normalizeSimulationColor(value)),
    activeLinkColorMode,
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
    simulationAppearanceSites: currentSimulationPreset?.snapshot.sites ??
      (mapEditor?.kind === "simulation" && mapEditor.isNew && mapEditor.simulationSeed?.copyCurrentSimulation
        ? sites
        : []),
  };
}
