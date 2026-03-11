import type { ChangeEvent } from "react";
import { useMemo, useState } from "react";
import clsx from "clsx";
import Map, { Marker, type MarkerDragEvent } from "react-map-gl/maplibre";
import { useSystemTheme } from "../hooks/useSystemTheme";
import { t, LOCALE_LABELS, SUPPORTED_LOCALES } from "../i18n/locales";
import { fetchElevations } from "../lib/elevationService";
import { FREQUENCY_PRESETS } from "../lib/frequencyPlans";
import { searchLocations, type GeocodeResult } from "../lib/geocode";
import { LEGACY_ASSETS } from "../lib/legacyAssets";
import { findMeshtasticPreset, MESHTASTIC_RF_PRESETS } from "../lib/meshtasticProfiles";
import { analyzeLink } from "../lib/propagation";
import { simulationAreaBoundsForSites } from "../lib/simulationArea";
import { sampleSrtmElevation } from "../lib/srtm";
import { PRIMARY_ATTRIBUTION, REMOTE_SRTM_ENDPOINTS } from "../lib/terrainCatalog";
import { tilesForBounds } from "../lib/ve2dbeTerrainClient";
import { useAppStore } from "../store/appStore";
import type { CoverageMode, PropagationModel } from "../types/radio";

const metric = (label: string, value: string) => (
  <div className="metric-row" key={label}>
    <span className="metric-label">{label}</span>
    <span className="metric-value">{value}</span>
  </div>
);

const parseNumber = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const InfoTip = ({ text }: { text: string }) => (
  <button aria-label={text} className="info-tip" type="button">
    i
    <span className="info-tip-box">{text}</span>
  </button>
);

const styleByTheme = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};

const clampSNR = (spreadFactor: number): number => {
  const map: Record<number, number> = {
    7: -7.5,
    8: -10,
    9: -12.5,
    10: -15,
    11: -17.5,
    12: -20,
  };
  return map[spreadFactor] ?? -10;
};

const estimateLoRaSensitivityDbm = (bandwidthKhz: number, spreadFactor: number): number => {
  const bandwidthHz = Math.max(1_000, bandwidthKhz * 1_000);
  const noiseFloor = -174 + 10 * Math.log10(bandwidthHz);
  const noiseFigure = 6;
  const snrLimit = clampSNR(spreadFactor);
  return noiseFloor + noiseFigure + snrLimit;
};

const downloadJson = (fileName: string, payload: unknown) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

export function Sidebar() {
  const theme = useSystemTheme();
  const links = useAppStore((state) => state.links);
  const sites = useAppStore((state) => state.sites);
  const srtmTiles = useAppStore((state) => state.srtmTiles);
  const siteLibrary = useAppStore((state) => state.siteLibrary);
  const simulationPresets = useAppStore((state) => state.simulationPresets);
  const selectedLinkId = useAppStore((state) => state.selectedLinkId);
  const selectedSiteId = useAppStore((state) => state.selectedSiteId);
  const selectedNetworkId = useAppStore((state) => state.selectedNetworkId);
  const selectedCoverageMode = useAppStore((state) => state.selectedCoverageMode);
  const selectedFrequencyPresetId = useAppStore((state) => state.selectedFrequencyPresetId);
  const rxSensitivityTargetDbm = useAppStore((state) => state.rxSensitivityTargetDbm);
  const environmentLossDb = useAppStore((state) => state.environmentLossDb);
  const selectedScenarioId = useAppStore((state) => state.selectedScenarioId);
  const scenarioOptions = useAppStore((state) => state.scenarioOptions);
  const locale = useAppStore((state) => state.locale);
  const networks = useAppStore((state) => state.networks);
  const setLocale = useAppStore((state) => state.setLocale);
  const selectScenario = useAppStore((state) => state.selectScenario);
  const setSelectedLinkId = useAppStore((state) => state.setSelectedLinkId);
  const setSelectedSiteId = useAppStore((state) => state.setSelectedSiteId);
  const setSelectedNetworkId = useAppStore((state) => state.setSelectedNetworkId);
  const setSelectedCoverageMode = useAppStore((state) => state.setSelectedCoverageMode);
  const setSelectedFrequencyPresetId = useAppStore((state) => state.setSelectedFrequencyPresetId);
  const setRxSensitivityTargetDbm = useAppStore((state) => state.setRxSensitivityTargetDbm);
  const setEnvironmentLossDb = useAppStore((state) => state.setEnvironmentLossDb);
  const endpointPickTarget = useAppStore((state) => state.endpointPickTarget);
  const setEndpointPickTarget = useAppStore((state) => state.setEndpointPickTarget);
  const applyFrequencyPresetToSelectedNetwork = useAppStore(
    (state) => state.applyFrequencyPresetToSelectedNetwork,
  );
  const setPropagationModel = useAppStore((state) => state.setPropagationModel);
  const updateLink = useAppStore((state) => state.updateLink);
  const ingestSrtmFiles = useAppStore((state) => state.ingestSrtmFiles);
  const syncSiteElevationsOnline = useAppStore((state) => state.syncSiteElevationsOnline);
  const terrainDataset = useAppStore((state) => state.terrainDataset);
  const terrainFetchStatus = useAppStore((state) => state.terrainFetchStatus);
  const terrainRecommendation = useAppStore((state) => state.terrainRecommendation);
  const setTerrainDataset = useAppStore((state) => state.setTerrainDataset);
  const insertSiteFromLibrary = useAppStore((state) => state.insertSiteFromLibrary);
  const insertSitesFromLibrary = useAppStore((state) => state.insertSitesFromLibrary);
  const updateSiteLibraryEntry = useAppStore((state) => state.updateSiteLibraryEntry);
  const deleteSiteLibraryEntry = useAppStore((state) => state.deleteSiteLibraryEntry);
  const deleteSiteLibraryEntries = useAppStore((state) => state.deleteSiteLibraryEntries);
  const deleteSite = useAppStore((state) => state.deleteSite);
  const createLink = useAppStore((state) => state.createLink);
  const deleteLink = useAppStore((state) => state.deleteLink);
  const addSiteLibraryEntry = useAppStore((state) => state.addSiteLibraryEntry);
  const saveCurrentSimulationPreset = useAppStore((state) => state.saveCurrentSimulationPreset);
  const loadSimulationPreset = useAppStore((state) => state.loadSimulationPreset);
  const deleteSimulationPreset = useAppStore((state) => state.deleteSimulationPreset);
  const recommendTerrainDatasetForCurrentArea = useAppStore(
    (state) => state.recommendTerrainDatasetForCurrentArea,
  );
  const fetchTerrainForCurrentArea = useAppStore((state) => state.fetchTerrainForCurrentArea);
  const recommendAndFetchTerrainForCurrentArea = useAppStore(
    (state) => state.recommendAndFetchTerrainForCurrentArea,
  );
  const clearTerrainCache = useAppStore((state) => state.clearTerrainCache);
  const getSelectedAnalysis = useAppStore((state) => state.getSelectedAnalysis);
  const getSelectedLink = useAppStore((state) => state.getSelectedLink);
  const getSelectedSite = useAppStore((state) => state.getSelectedSite);
  const getSelectedNetwork = useAppStore((state) => state.getSelectedNetwork);
  const model = useAppStore((state) => state.propagationModel);
  const analysis = getSelectedAnalysis();
  const selectedLink = getSelectedLink();
  const selectedSite = getSelectedSite();
  const selectedNetwork = getSelectedNetwork();
  const effectiveNetworkFrequencyMHz = selectedNetwork.frequencyOverrideMHz ?? selectedNetwork.frequencyMHz;
  const fromSite = sites.find((site) => site.id === selectedLink.fromSiteId);
  const toSite = sites.find((site) => site.id === selectedLink.toSiteId);
  const fromSiteChoices = sites.filter((site) => site.id !== selectedLink.toSiteId);
  const toSiteChoices = sites.filter((site) => site.id !== selectedLink.fromSiteId);
  const canEditEndpoints = sites.length >= 2;
  const sourceSite = sites.find((site) => site.id === selectedLink.fromSiteId);
  const destinationSite = sites.find((site) => site.id === selectedLink.toSiteId);
  const adjustedRxDbm = analysis.rxLevelDbm - environmentLossDb;
  const linkMarginDb = adjustedRxDbm - rxSensitivityTargetDbm;
  const loraSensitivitySuggestionDbm = estimateLoRaSensitivityDbm(
    selectedNetwork.bandwidthKhz,
    selectedNetwork.spreadFactor,
  );

  const runWhatIf = (
    txPowerDeltaDbm = 0,
    freqScale = 1,
    antennaDeltaM = 0,
  ): number | null => {
    if (!sourceSite || !destinationSite) return null;
    const alt = analyzeLink(
      {
        ...selectedLink,
        txPowerDbm: selectedLink.txPowerDbm + txPowerDeltaDbm,
        frequencyMHz: effectiveNetworkFrequencyMHz * freqScale,
      },
      { ...sourceSite, antennaHeightM: sourceSite.antennaHeightM + antennaDeltaM },
      { ...destinationSite, antennaHeightM: destinationSite.antennaHeightM + antennaDeltaM },
      model,
      ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
    );
    return alt.rxLevelDbm - environmentLossDb;
  };

  const whatIfRows = [
    { label: "Current", rxDbm: adjustedRxDbm },
    { label: "+3 dB TX", rxDbm: runWhatIf(3, 1, 0) },
    { label: "+6 dB TX", rxDbm: runWhatIf(6, 1, 0) },
    { label: "+10 m antennas", rxDbm: runWhatIf(0, 1, 10) },
    { label: "Freq -10%", rxDbm: runWhatIf(0, 0.9, 0) },
    { label: "Freq +10%", rxDbm: runWhatIf(0, 1.1, 0) },
  ].map((row) => ({
    ...row,
    marginDb: row.rxDbm === null ? null : row.rxDbm - rxSensitivityTargetDbm,
  }));
  const [newPresetName, setNewPresetName] = useState("");
  const [newLinkName, setNewLinkName] = useState("");
  const [newLinkFromId, setNewLinkFromId] = useState(sites[0]?.id ?? "");
  const [newLinkToId, setNewLinkToId] = useState(sites[1]?.id ?? "");
  const [showSiteLibraryManager, setShowSiteLibraryManager] = useState(false);
  const [siteLibraryQuery, setSiteLibraryQuery] = useState("");
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<Set<string>>(new Set());
  const [editingLibraryId, setEditingLibraryId] = useState<string | null>(null);
  const [editingLibraryName, setEditingLibraryName] = useState("");
  const [editingLibraryLat, setEditingLibraryLat] = useState(0);
  const [editingLibraryLon, setEditingLibraryLon] = useState(0);
  const [editingLibraryGroundM, setEditingLibraryGroundM] = useState(0);
  const [editingLibraryAntennaM, setEditingLibraryAntennaM] = useState(2);
  const [showAddLibraryForm, setShowAddLibraryForm] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState("");
  const [newLibraryLat, setNewLibraryLat] = useState(60.0);
  const [newLibraryLon, setNewLibraryLon] = useState(10.0);
  const [newLibraryGroundM, setNewLibraryGroundM] = useState(0);
  const [newLibraryAntennaM, setNewLibraryAntennaM] = useState(2);
  const [librarySearchQuery, setLibrarySearchQuery] = useState("");
  const [librarySearchStatus, setLibrarySearchStatus] = useState("");
  const [librarySearchResults, setLibrarySearchResults] = useState<GeocodeResult[]>([]);
  const [librarySearchPickBusyId, setLibrarySearchPickBusyId] = useState<string | null>(null);
  const simulationOptions = [
    ...scenarioOptions.map((scenario) => ({
      id: `builtin:${scenario.id}`,
      name: `${scenario.name} (built-in)`,
    })),
    ...simulationPresets.map((preset) => ({
      id: `saved:${preset.id}`,
      name: `${preset.name} (saved)`,
    })),
  ];
  const [selectedSimulationRef, setSelectedSimulationRef] = useState<string>(
    `builtin:${selectedScenarioId}`,
  );
  const effectiveSelectedPresetId = selectedSimulationRef.startsWith("saved:")
    ? selectedSimulationRef.replace("saved:", "")
    : simulationPresets[0]?.id ?? "";
  const hasTwoSites = sites.length >= 2;
  const hasPathEndpoints = Boolean(fromSite && toSite && fromSite.id !== toSite.id);
  const hasTerrain = srtmTiles.length > 0;
  const terrainBounds = simulationAreaBoundsForSites(sites);
  const requiredTerrainTileKeys = terrainBounds
    ? tilesForBounds(terrainBounds.minLat, terrainBounds.maxLat, terrainBounds.minLon, terrainBounds.maxLon)
    : [];
  const loadedTileKeys = new Set(srtmTiles.map((tile) => tile.key));
  const missingTerrainTileKeys = requiredTerrainTileKeys.filter((key) => !loadedTileKeys.has(key));
  const terrainIsStaleForCurrentArea = requiredTerrainTileKeys.length > 0 && missingTerrainTileKeys.length > 0;
  const filteredSiteLibrary = useMemo(() => {
    const q = siteLibraryQuery.trim().toLowerCase();
    if (!q) return siteLibrary;
    return siteLibrary.filter((entry) => {
      const hay = `${entry.name} ${entry.position.lat.toFixed(5)} ${entry.position.lon.toFixed(5)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [siteLibrary, siteLibraryQuery]);

  const applyRfPreset = (presetId: string) => {
    const preset = findMeshtasticPreset(presetId);
    if (!preset) return;
    updateLink(selectedLink.id, {
      txPowerDbm: preset.txPowerDbm,
      txGainDbi: preset.txGainDbi,
      rxGainDbi: preset.rxGainDbi,
      cableLossDb: preset.cableLossDb,
    });
    setEnvironmentLossDb(preset.environmentLossDb);
  };

  const onModelChange = (next: PropagationModel) => {
    setPropagationModel(next);
  };

  const onCoverageModeChange = (mode: CoverageMode) => {
    setSelectedCoverageMode(mode);
  };

  const onUploadTiles = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;
    await ingestSrtmFiles(event.target.files);
    event.target.value = "";
  };

  const exportManifest = () => {
    const terrainSources = srtmTiles.reduce<Record<string, number>>((acc, tile) => {
      const key = tile.sourceLabel ?? "Unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

      const manifest = {
      exportedAt: new Date().toISOString(),
      scenarioId: selectedScenarioId,
      locale,
      propagationModel: model,
      selectedCoverageMode,
      selectedFrequencyPresetId,
      terrainDataset,
      terrainRecommendation,
      terrainFetchStatus,
      sites,
      links,
      systems: useAppStore.getState().systems,
      networks,
      selectedLinkId,
      selectedNetworkId,
      selectedSiteId,
      rxSensitivityTargetDbm,
      environmentLossDb,
      hasOnlineElevationSync: useAppStore.getState().hasOnlineElevationSync,
      terrainTileCount: srtmTiles.length,
      terrainSources,
      selectedAnalysis: analysis,
      linkBudget: {
        targetSensitivityDbm: rxSensitivityTargetDbm,
        adjustedRxDbm,
        marginDb: linkMarginDb,
        whatIfRows,
      },
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadJson(`radio-mobile-web-manifest-${stamp}.json`, manifest);
  };

  const loadSimulationRef = (ref: string) => {
    setSelectedSimulationRef(ref);
    if (ref.startsWith("builtin:")) {
      selectScenario(ref.replace("builtin:", ""));
      return;
    }
    if (ref.startsWith("saved:")) {
      loadSimulationPreset(ref.replace("saved:", ""));
    }
  };

  const createNewLink = () => {
    if (!newLinkFromId || !newLinkToId || newLinkFromId === newLinkToId) return;
    createLink(newLinkFromId, newLinkToId, newLinkName);
    setNewLinkName("");
  };
  const displayLinkName = (linkId: string, linkName?: string) => {
    const trimmedName = linkName?.trim();
    if (trimmedName) return trimmedName;
    const link = links.find((candidate) => candidate.id === linkId);
    if (!link) return linkId;
    const from = sites.find((site) => site.id === link.fromSiteId)?.name ?? "Unknown";
    const to = sites.find((site) => site.id === link.toSiteId)?.name ?? "Unknown";
    return `${from} -> ${to}`;
  };
  const toggleLibrarySelection = (entryId: string) => {
    setSelectedLibraryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };
  const selectedLibraryCount = selectedLibraryIds.size;
  const startLibraryEdit = (entryId: string) => {
    const entry = siteLibrary.find((candidate) => candidate.id === entryId);
    if (!entry) return;
    setEditingLibraryId(entry.id);
    setEditingLibraryName(entry.name);
    setEditingLibraryLat(entry.position.lat);
    setEditingLibraryLon(entry.position.lon);
    setEditingLibraryGroundM(entry.groundElevationM);
    setEditingLibraryAntennaM(entry.antennaHeightM);
  };
  const saveLibraryEdit = () => {
    if (!editingLibraryId) return;
    updateSiteLibraryEntry(editingLibraryId, {
      name: editingLibraryName.trim() || "Unnamed Site",
      position: { lat: editingLibraryLat, lon: editingLibraryLon },
      groundElevationM: editingLibraryGroundM,
      antennaHeightM: editingLibraryAntennaM,
    });
    setEditingLibraryId(null);
  };
  const addLibraryEntryNow = () => {
    addSiteLibraryEntry(
      newLibraryName,
      newLibraryLat,
      newLibraryLon,
      newLibraryGroundM,
      newLibraryAntennaM,
    );
    setNewLibraryName("");
    setShowAddLibraryForm(false);
  };
  const runLibrarySearch = async () => {
    setLibrarySearchStatus("Searching...");
    try {
      const results = await searchLocations(librarySearchQuery);
      setLibrarySearchResults(results);
      setLibrarySearchStatus(results.length ? `Found ${results.length} result(s)` : "No results");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLibrarySearchStatus(`Search failed: ${message}`);
    }
  };
  const selectLibrarySearchResult = async (result: GeocodeResult) => {
    setLibrarySearchPickBusyId(result.id);
    setLibrarySearchStatus("Resolving elevation for selected result...");
    setNewLibraryName(result.label.split(",")[0] ?? "New Site");
    setNewLibraryLat(result.lat);
    setNewLibraryLon(result.lon);
    try {
      const [elevation] = await fetchElevations([{ lat: result.lat, lon: result.lon }]);
      if (Number.isFinite(elevation)) {
        setNewLibraryGroundM(Math.round(elevation));
        setLibrarySearchStatus(`Selected: ${result.label} (elevation ${Math.round(elevation)} m)`);
      } else {
        setLibrarySearchStatus(`Selected: ${result.label} (elevation unavailable)`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLibrarySearchStatus(`Selected coordinates, elevation lookup failed: ${message}`);
    } finally {
      setLibrarySearchPickBusyId(null);
    }
  };

  return (
    <aside className="sidebar-panel">
      <header>
        <h1>{t(locale, "appTitle")}</h1>
        <p>{t(locale, "workspaceSubtitle")}</p>
      </header>
      <section className="panel-section">
        <h2>{t(locale, "networkCoverageWorkspace")}</h2>
        <p className="field-help">
          Choose sites and a From/To path, then tune channel settings for coverage and link analysis.
        </p>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <h2>Simulations</h2>
          <InfoTip text="Load a built-in scenario or a saved simulation snapshot. Save updates under a new name to quickly resume later." />
        </div>
        <select
          className="locale-select"
          onChange={(event) => loadSimulationRef(event.target.value)}
          value={selectedSimulationRef}
        >
          {simulationOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <label className="field-grid">
          <span>Save as</span>
          <input
            onChange={(event) => setNewPresetName(event.target.value)}
            placeholder="My simulation"
            type="text"
            value={newPresetName}
          />
        </label>
        <div className="chip-group">
          <button
            className="inline-action"
            onClick={() => {
              saveCurrentSimulationPreset(newPresetName);
              setNewPresetName("");
            }}
            type="button"
          >
            Save Simulation
          </button>
          <button
            className="inline-action"
            disabled={!effectiveSelectedPresetId}
            onClick={() => effectiveSelectedPresetId && deleteSimulationPreset(effectiveSelectedPresetId)}
            type="button"
          >
            Delete Saved
          </button>
        </div>
      </section>

      <section className="panel-section">
        <h2>Setup Status</h2>
        <div className="asset-list">
          <p className="field-help">{hasTwoSites ? `Sites: ${sites.length} configured` : "Sites: add at least 2"}</p>
          <p className="field-help">
            {hasPathEndpoints
              ? `Path: ${fromSite?.name ?? "?"} → ${toSite?.name ?? "?"}`
              : "Path: choose different From/To nodes"}
          </p>
          <p className="field-help">
            {terrainIsStaleForCurrentArea
              ? `Terrain: out of date (${missingTerrainTileKeys.length}/${requiredTerrainTileKeys.length} tiles missing for current area)`
              : hasTerrain
                ? `Terrain: up to date (${srtmTiles.length} tile(s) loaded)`
                : "Terrain: not loaded yet"}
          </p>
          {terrainBounds?.isCapped ? (
            <p className="field-help">Area window capped to 5° span for performance.</p>
          ) : null}
        </div>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <h2>Sites</h2>
          <InfoTip text="Site add/edit is managed in Site Library Manager. Here you only include or remove sites in this simulation." />
        </div>
        <p className="field-help">Use Site Library Manager to add/edit sites, then add selected sites to this project.</p>
        <div className="chip-group">
          <button className="inline-action" onClick={() => setShowSiteLibraryManager(true)} type="button">
            Open Site Library Manager ({siteLibrary.length})
          </button>
          {siteLibrary.length ? (
            <button className="inline-action" onClick={() => insertSiteFromLibrary(siteLibrary[0].id)} type="button">
              Insert Newest
            </button>
          ) : null}
        </div>
        {!siteLibrary.length ? <p className="field-help">No saved library sites yet.</p> : null}
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <h2>Channel / Coverage</h2>
          <InfoTip text="This is the shared channel profile. Frequency, bandwidth, spreading factor, and coding rate apply to all links." />
        </div>
        {networks.length > 1 ? (
          <select
            className="locale-select"
            onChange={(event) => setSelectedNetworkId(event.target.value)}
            value={selectedNetworkId}
          >
            {networks.map((network) => (
              <option key={network.id} value={network.id}>
                {network.name} ({(network.frequencyOverrideMHz ?? network.frequencyMHz).toFixed(3)} MHz)
              </option>
            ))}
          </select>
        ) : (
          <p className="field-help">
            Active channel profile: <strong>{selectedNetwork.name}</strong>
          </p>
        )}
        <p className="field-help">Coverage mode controls map sampling strategy.</p>
        <div className="chip-group">
          {(["BestSite", "Polar", "Cartesian", "Route"] as const).map((mode) => (
            <button
              className={clsx("chip-button", selectedCoverageMode === mode && "is-selected")}
              key={mode}
              onClick={() => onCoverageModeChange(mode)}
              type="button"
            >
              {mode}
            </button>
          ))}
        </div>
        <label className="field-grid">
          <span>Frequency Plan</span>
          <select
            className="locale-select"
            onChange={(event) => setSelectedFrequencyPresetId(event.target.value)}
            value={selectedFrequencyPresetId}
          >
            {FREQUENCY_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <button className="inline-action" onClick={() => applyFrequencyPresetToSelectedNetwork()} type="button">
          Apply Frequency Plan
        </button>
        <div className="section-heading">
          <p className="field-help">Propagation model (advanced)</p>
          <InfoTip text="FSPL: free-space path loss only (optimistic, no terrain blocking). TwoRay: direct + ground-reflection model for flatter/open paths, still no terrain profile blocking. ITM: terrain-aware approximation using elevation diffraction penalty in this tool; generally the most realistic option here for hilly/mountain links." />
        </div>
        <div className="chip-group">
          {(["FSPL", "TwoRay", "ITM"] as const).map((candidate) => (
            <button
              className={clsx("chip-button", model === candidate && "is-selected")}
              key={candidate}
              onClick={() => onModelChange(candidate)}
              type="button"
            >
              {candidate}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <h2>Path (From / To)</h2>
          <InfoTip text="Choose the two nodes for link analysis. Link radio values below are per-path hardware settings." />
        </div>
        <div className="link-list">
          {links.map((link) => (
            <button
              className={clsx("link-item", selectedLinkId === link.id && "is-selected")}
              key={link.id}
              onClick={() => setSelectedLinkId(link.id)}
              type="button"
            >
              <span className="link-title">{displayLinkName(link.id, link.name)}</span>
              <span className="link-subtitle">{effectiveNetworkFrequencyMHz.toFixed(3)} MHz (from channel)</span>
            </button>
          ))}
        </div>
        <label className="field-grid">
          <span>New link name</span>
          <input
            onChange={(event) => setNewLinkName(event.target.value)}
            placeholder="Backhaul A"
            type="text"
            value={newLinkName}
          />
        </label>
        <label className="field-grid">
          <span>New from</span>
          <select
            className="locale-select"
            onChange={(event) => {
              setNewLinkFromId(event.target.value);
              if (event.target.value === newLinkToId) {
                const fallback = sites.find((site) => site.id !== event.target.value)?.id ?? "";
                setNewLinkToId(fallback);
              }
            }}
            value={newLinkFromId}
          >
            {sites.map((site) => (
              <option key={`new-from-${site.id}`} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-grid">
          <span>New to</span>
          <select
            className="locale-select"
            onChange={(event) => setNewLinkToId(event.target.value)}
            value={newLinkToId}
          >
            {sites
              .filter((site) => site.id !== newLinkFromId)
              .map((site) => (
                <option key={`new-to-${site.id}`} value={site.id}>
                  {site.name}
                </option>
              ))}
          </select>
        </label>
        <div className="chip-group">
          <button
            className="inline-action"
            disabled={!newLinkFromId || !newLinkToId || newLinkFromId === newLinkToId}
            onClick={createNewLink}
            type="button"
          >
            Create Link
          </button>
          <button
            className="inline-action"
            disabled={links.length <= 1}
            onClick={() => deleteLink(selectedLink.id)}
            type="button"
          >
            Delete Selected Link
          </button>
        </div>

        <div className="endpoint-summary" aria-live="polite">
          {fromSite?.name ?? "Unknown"} <span aria-hidden>→</span> {toSite?.name ?? "Unknown"}
        </div>
        <div className="endpoint-picker-row">
          <button
            className={clsx("chip-button", endpointPickTarget === "from" && "is-selected")}
            disabled={!canEditEndpoints}
            onClick={() => setEndpointPickTarget(endpointPickTarget === "from" ? null : "from")}
            type="button"
          >
            Pick From On Map
          </button>
          <button
            className={clsx("chip-button", endpointPickTarget === "to" && "is-selected")}
            disabled={!canEditEndpoints}
            onClick={() => setEndpointPickTarget(endpointPickTarget === "to" ? null : "to")}
            type="button"
          >
            Pick To On Map
          </button>
        </div>
        {endpointPickTarget ? (
          <p className="field-help">
            Map picker active: click a node marker to set the {endpointPickTarget === "from" ? "From" : "To"} site.
          </p>
        ) : null}

        <label className="field-grid endpoint-field">
          <span>From site</span>
          <select
            className="locale-select"
            disabled={!canEditEndpoints}
            onChange={(event) => updateLink(selectedLink.id, { fromSiteId: event.target.value })}
            value={selectedLink.fromSiteId}
          >
            {fromSiteChoices.map((site) => (
              <option key={`from-${site.id}`} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field-grid endpoint-field">
          <span>To site</span>
          <select
            className="locale-select"
            disabled={!canEditEndpoints}
            onChange={(event) => updateLink(selectedLink.id, { toSiteId: event.target.value })}
            value={selectedLink.toSiteId}
          >
            {toSiteChoices.map((site) => (
              <option key={`to-${site.id}`} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        {!canEditEndpoints ? <p className="field-help">Add at least two sites to define a link path.</p> : null}
        <label className="field-grid">
          <span>Link name</span>
          <input
            onChange={(event) => updateLink(selectedLink.id, { name: event.target.value })}
            placeholder={`${fromSite?.name ?? "From"} -> ${toSite?.name ?? "To"}`}
            type="text"
            value={selectedLink.name ?? ""}
          />
        </label>

        <p className="field-help">Frequency is controlled in Channel / Coverage and shared by all links.</p>
        <details className="compact-details">
          <summary>Advanced Link Radio</summary>
          <label className="field-grid">
            <span>Tx power (dBm)</span>
            <input
              onChange={(event) =>
                updateLink(selectedLink.id, { txPowerDbm: parseNumber(event.target.value) })
              }
              type="number"
              value={selectedLink.txPowerDbm}
            />
          </label>
          <label className="field-grid">
            <span>Tx gain (dBi)</span>
            <input
              onChange={(event) =>
                updateLink(selectedLink.id, { txGainDbi: parseNumber(event.target.value) })
              }
              type="number"
              value={selectedLink.txGainDbi}
            />
          </label>
          <label className="field-grid">
            <span>Rx gain (dBi)</span>
            <input
              onChange={(event) =>
                updateLink(selectedLink.id, { rxGainDbi: parseNumber(event.target.value) })
              }
              type="number"
              value={selectedLink.rxGainDbi}
            />
          </label>
          <label className="field-grid">
            <span>Cable loss (dB)</span>
            <input
              onChange={(event) =>
                updateLink(selectedLink.id, { cableLossDb: parseNumber(event.target.value) })
              }
              type="number"
              value={selectedLink.cableLossDb}
            />
          </label>
          <label className="field-grid">
            <span>RF preset</span>
            <select
              className="locale-select"
              onChange={(event) => applyRfPreset(event.target.value)}
              value=""
            >
              <option value="" disabled>
                Apply preset...
              </option>
              {MESHTASTIC_RF_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
        </details>
      </section>

      <section className="panel-section">
        <h2>Selected Site</h2>
        <div className="chip-group">
          {sites.map((site) => (
            <button
              className={clsx("chip-button", selectedSiteId === site.id && "is-selected")}
              key={site.id}
              onClick={() => setSelectedSiteId(site.id)}
              type="button"
            >
              {site.name}
            </button>
          ))}
        </div>
        <button
          className="inline-action"
          disabled={sites.length <= 1}
          onClick={() => deleteSite(selectedSite.id)}
          type="button"
        >
          Remove Selected From Project
        </button>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <h2>{t(locale, "terrainData")}</h2>
          <InfoTip text="Terrain data is used directly in path profile and obstruction/loss calculations." />
        </div>
        <p>{srtmTiles.length} SRTM tile(s) loaded</p>
        <button
          className="inline-action"
          onClick={() => void recommendAndFetchTerrainForCurrentArea()}
          type="button"
        >
          Auto Fetch Terrain Data
        </button>
        <details className="compact-details">
          <summary>Advanced Terrain Options</summary>
          <label className="field-grid">
            <span>ve2dbe source</span>
            <select
              className="locale-select"
              onChange={(event) => setTerrainDataset(event.target.value as "srtm1" | "srtm3" | "srtmthird")}
              value={terrainDataset}
            >
              <option value="srtm1">SRTM1</option>
              <option value="srtm3">SRTM3</option>
              <option value="srtmthird">SRTM Third</option>
            </select>
          </label>
          <button className="inline-action" onClick={() => void fetchTerrainForCurrentArea()} type="button">
            Fetch Current Area (Current Source)
          </button>
          <button
            className="inline-action"
            onClick={() => void recommendTerrainDatasetForCurrentArea()}
            type="button"
          >
            Recommend Source Only
          </button>
          <label className="upload-button">
            {t(locale, "loadHgt")}
            <input accept=".hgt,.zip,.hgt.zip" multiple onChange={onUploadTiles} type="file" />
          </label>
          <button className="inline-action" onClick={() => void syncSiteElevationsOnline()} type="button">
            {t(locale, "syncSiteElevations")}
          </button>
          <button className="inline-action" onClick={() => void clearTerrainCache()} type="button">
            Clear ve2dbe Cache
          </button>
          {terrainRecommendation ? <p className="field-help">{terrainRecommendation}</p> : null}
          {terrainFetchStatus ? <p className="field-help">{terrainFetchStatus}</p> : null}
          <div className="asset-list">
            <a href={REMOTE_SRTM_ENDPOINTS[terrainDataset]} rel="noreferrer" target="_blank">
              Open selected ve2dbe dataset source
            </a>
            <a href="https://www.ve2dbe.com/geodata/" rel="noreferrer" target="_blank">
              ve2dbe geodata selector
            </a>
          </div>
        </details>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <h2>{t(locale, "rfSummary")}</h2>
          <InfoTip text="Computed link budget summary for the selected path and current channel/model settings." />
        </div>
        <div className="metrics">
          {metric("Network", `${selectedNetwork.name} (${selectedCoverageMode})`)}
          {metric(
            "LoRa",
            `${(selectedNetwork.frequencyOverrideMHz ?? selectedNetwork.frequencyMHz).toFixed(3)} MHz / BW ${selectedNetwork.bandwidthKhz} / SF ${selectedNetwork.spreadFactor} / CR ${selectedNetwork.codingRate}`,
          )}
          {metric("Distance", `${analysis.distanceKm.toFixed(2)} km`)}
          {metric("Model", analysis.model)}
          {metric("Path loss", `${analysis.pathLossDb.toFixed(1)} dB`)}
          {metric("FSPL", `${analysis.fsplDb.toFixed(1)} dB`)}
          {metric("EIRP", `${analysis.eirpDbm.toFixed(1)} dBm`)}
          {metric("RX estimate (raw)", `${analysis.rxLevelDbm.toFixed(1)} dBm`)}
          {metric("RX estimate (calibrated)", `${adjustedRxDbm.toFixed(1)} dBm`)}
          {metric("Earth bulge", `${analysis.midpointEarthBulgeM.toFixed(2)} m`)}
          {metric("F1 radius", `${analysis.firstFresnelRadiusM.toFixed(2)} m`)}
          {metric("Clearance", `${analysis.geometricClearanceM.toFixed(2)} m`)}
          {metric(
            "Fresnel clearance",
            `${analysis.estimatedFresnelClearancePercent.toFixed(0)}%`,
          )}
        </div>
        <label className="field-grid">
          <span>RX target (dBm)</span>
          <input
            onChange={(event) => setRxSensitivityTargetDbm(parseNumber(event.target.value))}
            type="number"
            value={rxSensitivityTargetDbm}
          />
        </label>
        <label className="field-grid">
          <span>Env loss (dB)</span>
          <input
            min={0}
            onChange={(event) => setEnvironmentLossDb(parseNumber(event.target.value))}
            type="number"
            value={environmentLossDb}
          />
        </label>
        <button
          className="inline-action"
          onClick={() => setRxSensitivityTargetDbm(Math.round(loraSensitivitySuggestionDbm))}
          type="button"
        >
          Use LoRa Estimate ({loraSensitivitySuggestionDbm.toFixed(1)} dBm)
        </button>
        <div className={clsx("margin-status", linkMarginDb >= 0 ? "is-pass" : "is-fail")}>
          Link margin: {linkMarginDb >= 0 ? "+" : ""}
          {linkMarginDb.toFixed(1)} dB ({linkMarginDb >= 0 ? "PASS" : "FAIL"})
        </div>
        <div className="whatif-table">
          {whatIfRows.map((row) => (
            <div className="whatif-row" key={row.label}>
              <span>{row.label}</span>
              <span>{row.rxDbm === null ? "n/a" : `${row.rxDbm.toFixed(1)} dBm`}</span>
              <span>
                {row.marginDb === null ? "n/a" : `${row.marginDb >= 0 ? "+" : ""}${row.marginDb.toFixed(1)} dB`}
              </span>
            </div>
          ))}
        </div>
        <button className="inline-action" onClick={exportManifest} type="button">
          Export Simulation Manifest
        </button>
      </section>

      <section className="panel-section">
        <details className="compact-details">
          <summary>More</summary>
          <label className="field-grid">
            <span>Language</span>
            <select
              className="locale-select"
              onChange={(event) => setLocale(event.target.value as (typeof SUPPORTED_LOCALES)[number])}
              value={locale}
            >
              {SUPPORTED_LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_LABELS[code]}
                </option>
              ))}
            </select>
          </label>
          <p className="field-help">References and external resources:</p>
          <div className="asset-list">
            {LEGACY_ASSETS.map((asset) => (
              <a href={asset.url} key={asset.url} rel="noreferrer" target="_blank">
                {asset.label}
              </a>
            ))}
          </div>
        </details>
      </section>

      {showSiteLibraryManager ? (
        <div aria-label="Site Library Manager" aria-modal="true" className="library-manager-overlay" role="dialog">
          <div className="library-manager-card">
            <div className="library-manager-header">
              <h2>Site Library Manager</h2>
              <button className="inline-action" onClick={() => setShowSiteLibraryManager(false)} type="button">
                Close
              </button>
            </div>
            <p className="field-help">
              Built for large libraries. Select one or more entries to add into this simulation project.
            </p>
            <label className="field-grid">
              <span>Search</span>
              <input
                onChange={(event) => setSiteLibraryQuery(event.target.value)}
                placeholder="Filter by name or coordinates"
                type="text"
                value={siteLibraryQuery}
              />
            </label>
            <div className="chip-group">
              <button
                className="inline-action"
                onClick={() => setShowAddLibraryForm((current) => !current)}
                type="button"
              >
                {showAddLibraryForm ? "Hide Add" : "Add Library Site"}
              </button>
              <button
                className="inline-action"
                onClick={() => setSelectedLibraryIds(new Set(filteredSiteLibrary.map((entry) => entry.id)))}
                type="button"
              >
                Select Filtered ({filteredSiteLibrary.length})
              </button>
              <button className="inline-action" onClick={() => setSelectedLibraryIds(new Set())} type="button">
                Clear Selection
              </button>
              <button
                className="inline-action"
                disabled={!selectedLibraryCount}
                onClick={() => {
                  insertSitesFromLibrary(Array.from(selectedLibraryIds));
                  setSelectedLibraryIds(new Set());
                }}
                type="button"
              >
                Add Selected To Project ({selectedLibraryCount})
              </button>
              <button
                className="inline-action"
                disabled={!selectedLibraryCount}
                onClick={() => {
                  deleteSiteLibraryEntries(Array.from(selectedLibraryIds));
                  setSelectedLibraryIds(new Set());
                }}
                type="button"
              >
                Delete Selected ({selectedLibraryCount})
              </button>
            </div>
            {showAddLibraryForm ? (
              <div className="library-editor">
                <h3>Add Library Site</h3>
                <label className="field-grid">
                  <span>Name</span>
                  <input
                    onChange={(event) => setNewLibraryName(event.target.value)}
                    placeholder="My site"
                    type="text"
                    value={newLibraryName}
                  />
                </label>
                <label className="field-grid">
                  <span>Latitude</span>
                  <input
                    onChange={(event) => setNewLibraryLat(parseNumber(event.target.value))}
                    step="0.000001"
                    type="number"
                    value={newLibraryLat}
                  />
                </label>
                <label className="field-grid">
                  <span>Longitude</span>
                  <input
                    onChange={(event) => setNewLibraryLon(parseNumber(event.target.value))}
                    step="0.000001"
                    type="number"
                    value={newLibraryLon}
                  />
                </label>
                <label className="field-grid">
                  <span>Ground elev (m)</span>
                  <input
                    onChange={(event) => setNewLibraryGroundM(parseNumber(event.target.value))}
                    type="number"
                    value={newLibraryGroundM}
                  />
                </label>
                <label className="field-grid">
                  <span>Antenna (m)</span>
                  <input
                    onChange={(event) => setNewLibraryAntennaM(parseNumber(event.target.value))}
                    type="number"
                    value={newLibraryAntennaM}
                  />
                </label>
                <label className="field-grid">
                  <span>Map Search</span>
                  <input
                    onChange={(event) => setLibrarySearchQuery(event.target.value)}
                    placeholder="Address or place"
                    type="text"
                    value={librarySearchQuery}
                  />
                </label>
                <button className="inline-action" onClick={() => void runLibrarySearch()} type="button">
                  Search
                </button>
                {librarySearchStatus ? <p className="field-help">{librarySearchStatus}</p> : null}
                {librarySearchResults.length ? (
                  <div className="asset-list">
                    {librarySearchResults.map((result) => (
                      <button
                        className="inline-action"
                        disabled={librarySearchPickBusyId !== null}
                        key={result.id}
                        onClick={() => void selectLibrarySearchResult(result)}
                        type="button"
                      >
                        {librarySearchPickBusyId === result.id ? "Loading..." : `Use: ${result.label}`}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="chip-group">
                  <button className="inline-action" onClick={addLibraryEntryNow} type="button">
                    Add To Library
                  </button>
                  <button className="inline-action" onClick={() => setShowAddLibraryForm(false)} type="button">
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            <div className="library-manager-list">
              {filteredSiteLibrary.map((entry) => (
                <div className="library-manager-row" key={entry.id}>
                  <input
                    checked={selectedLibraryIds.has(entry.id)}
                    onChange={() => toggleLibrarySelection(entry.id)}
                    type="checkbox"
                  />
                  <span className="library-row-label">
                    {entry.name} ({entry.position.lat.toFixed(5)}, {entry.position.lon.toFixed(5)})
                  </span>
                  <div className="library-row-actions">
                    <button className="inline-action" onClick={() => insertSiteFromLibrary(entry.id)} type="button">
                      Add
                    </button>
                    <button className="inline-action" onClick={() => startLibraryEdit(entry.id)} type="button">
                      Edit
                    </button>
                    <button className="inline-action" onClick={() => deleteSiteLibraryEntry(entry.id)} type="button">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {!filteredSiteLibrary.length ? <p className="field-help">No matching sites.</p> : null}
            </div>
            {editingLibraryId ? (
              <div className="library-editor">
                <h3>Edit Library Site</h3>
                <label className="field-grid">
                  <span>Name</span>
                  <input
                    onChange={(event) => setEditingLibraryName(event.target.value)}
                    type="text"
                    value={editingLibraryName}
                  />
                </label>
                <label className="field-grid">
                  <span>Latitude</span>
                  <input
                    onChange={(event) => setEditingLibraryLat(parseNumber(event.target.value))}
                    step="0.000001"
                    type="number"
                    value={editingLibraryLat}
                  />
                </label>
                <label className="field-grid">
                  <span>Longitude</span>
                  <input
                    onChange={(event) => setEditingLibraryLon(parseNumber(event.target.value))}
                    step="0.000001"
                    type="number"
                    value={editingLibraryLon}
                  />
                </label>
                <label className="field-grid">
                  <span>Ground elev (m)</span>
                  <input
                    onChange={(event) => setEditingLibraryGroundM(parseNumber(event.target.value))}
                    type="number"
                    value={editingLibraryGroundM}
                  />
                </label>
                <label className="field-grid">
                  <span>Antenna (m)</span>
                  <input
                    onChange={(event) => setEditingLibraryAntennaM(parseNumber(event.target.value))}
                    type="number"
                    value={editingLibraryAntennaM}
                  />
                </label>
                <div className="library-editor-map">
                  <Map
                    initialViewState={{
                      longitude: editingLibraryLon,
                      latitude: editingLibraryLat,
                      zoom: 12,
                    }}
                    latitude={editingLibraryLat}
                    longitude={editingLibraryLon}
                    mapStyle={styleByTheme[theme]}
                    onClick={(event) => {
                      setEditingLibraryLat(event.lngLat.lat);
                      setEditingLibraryLon(event.lngLat.lng);
                    }}
                    zoom={12}
                  >
                    <Marker
                      anchor="bottom"
                      draggable
                      latitude={editingLibraryLat}
                      longitude={editingLibraryLon}
                      onDragEnd={(event: MarkerDragEvent) => {
                        setEditingLibraryLat(event.lngLat.lat);
                        setEditingLibraryLon(event.lngLat.lng);
                      }}
                    >
                      <div className="site-pin library-edit-pin">
                        <span>{editingLibraryName.trim() || "Site"}</span>
                      </div>
                    </Marker>
                  </Map>
                </div>
                <div className="chip-group">
                  <button className="inline-action" onClick={saveLibraryEdit} type="button">
                    Save
                  </button>
                  <button className="inline-action" onClick={() => setEditingLibraryId(null)} type="button">
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="sidebar-grow" />
      <footer className="sidebar-footer">
        <p>
          Inspired by{" "}
          <a href={PRIMARY_ATTRIBUTION.projectUrl} rel="noreferrer" target="_blank">
            {PRIMARY_ATTRIBUTION.projectName}
          </a>{" "}
          by {PRIMARY_ATTRIBUTION.authorName}. {PRIMARY_ATTRIBUTION.disclaimer}
        </p>
        <p>Basemap style: {theme === "dark" ? "Carto Dark Matter" : "Carto Positron"} (attribution applies).</p>
      </footer>
    </aside>
  );
}
