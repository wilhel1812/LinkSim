import type { ChangeEvent } from "react";
import { useState } from "react";
import clsx from "clsx";
import { t, LOCALE_LABELS, SUPPORTED_LOCALES } from "../i18n/locales";
import { FREQUENCY_PRESETS } from "../lib/frequencyPlans";
import { searchLocations, type GeocodeResult } from "../lib/geocode";
import { LEGACY_ASSETS } from "../lib/legacyAssets";
import { findMeshtasticPreset, MESHTASTIC_RF_PRESETS } from "../lib/meshtasticProfiles";
import { analyzeLink } from "../lib/propagation";
import { sampleSrtmElevation } from "../lib/srtm";
import { REMOTE_SRTM_ENDPOINTS } from "../lib/terrainCatalog";
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
  const updateSite = useAppStore((state) => state.updateSite);
  const updateLink = useAppStore((state) => state.updateLink);
  const ingestSrtmFiles = useAppStore((state) => state.ingestSrtmFiles);
  const syncSiteElevationsOnline = useAppStore((state) => state.syncSiteElevationsOnline);
  const terrainDataset = useAppStore((state) => state.terrainDataset);
  const terrainFetchStatus = useAppStore((state) => state.terrainFetchStatus);
  const terrainRecommendation = useAppStore((state) => state.terrainRecommendation);
  const setTerrainDataset = useAppStore((state) => state.setTerrainDataset);
  const addSiteByCoordinates = useAppStore((state) => state.addSiteByCoordinates);
  const saveSelectedSiteToLibrary = useAppStore((state) => state.saveSelectedSiteToLibrary);
  const insertSiteFromLibrary = useAppStore((state) => state.insertSiteFromLibrary);
  const deleteSiteLibraryEntry = useAppStore((state) => state.deleteSiteLibraryEntry);
  const deleteSite = useAppStore((state) => state.deleteSite);
  const createLink = useAppStore((state) => state.createLink);
  const deleteLink = useAppStore((state) => state.deleteLink);
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
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteLat, setNewSiteLat] = useState(sourceSite?.position.lat ?? 60.0);
  const [newSiteLon, setNewSiteLon] = useState(sourceSite?.position.lon ?? 10.0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [searchStatus, setSearchStatus] = useState("");
  const [newPresetName, setNewPresetName] = useState("");
  const [newLinkName, setNewLinkName] = useState("");
  const [newLinkFromId, setNewLinkFromId] = useState(sites[0]?.id ?? "");
  const [newLinkToId, setNewLinkToId] = useState(sites[1]?.id ?? "");
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

  const applyRfPreset = (presetId: string) => {
    const preset = findMeshtasticPreset(presetId);
    if (!preset || !sourceSite || !destinationSite) return;
    updateLink(selectedLink.id, {
      txPowerDbm: preset.txPowerDbm,
      txGainDbi: preset.txGainDbi,
      rxGainDbi: preset.rxGainDbi,
      cableLossDb: preset.cableLossDb,
    });
    updateSite(sourceSite.id, { antennaHeightM: preset.antennaHeightM });
    updateSite(destinationSite.id, { antennaHeightM: preset.antennaHeightM });
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

  const addSiteNow = () => {
    if (!Number.isFinite(newSiteLat) || !Number.isFinite(newSiteLon)) return;
    addSiteByCoordinates(newSiteName, newSiteLat, newSiteLon);
    setNewSiteName("");
  };

  const runSearch = async () => {
    setSearchStatus("Searching...");
    try {
      const results = await searchLocations(searchQuery);
      setSearchResults(results);
      setSearchStatus(results.length ? `Found ${results.length} result(s)` : "No results");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSearchStatus(`Search failed: ${message}`);
    }
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

  return (
    <aside className="sidebar-panel">
      <header>
        <h1>{t(locale, "appTitle")}</h1>
        <p>{t(locale, "workspaceSubtitle")}</p>
      </header>

      <section className="panel-section">
        <h2>Language</h2>
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
      </section>

      <section className="panel-section">
        <h2>Simulations</h2>
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
        <h2>Site Builder</h2>
        <label className="field-grid">
          <span>Name</span>
          <input
            onChange={(event) => setNewSiteName(event.target.value)}
            type="text"
            value={newSiteName}
          />
        </label>
        <label className="field-grid">
          <span>Lat</span>
          <input
            onChange={(event) => setNewSiteLat(parseNumber(event.target.value))}
            step="0.000001"
            type="number"
            value={newSiteLat}
          />
        </label>
        <label className="field-grid">
          <span>Lon</span>
          <input
            onChange={(event) => setNewSiteLon(parseNumber(event.target.value))}
            step="0.000001"
            type="number"
            value={newSiteLon}
          />
        </label>
        <button className="inline-action" onClick={addSiteNow} type="button">
          Add Site
        </button>
        <button className="inline-action" onClick={() => saveSelectedSiteToLibrary()} type="button">
          Save Selected Site To Library
        </button>
        <label className="field-grid">
          <span>Map Search</span>
          <input
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Address or place"
            type="text"
            value={searchQuery}
          />
        </label>
        <button className="inline-action" onClick={() => void runSearch()} type="button">
          Search
        </button>
        {searchStatus ? <p className="field-help">{searchStatus}</p> : null}
        {searchResults.length ? (
          <div className="asset-list">
            {searchResults.map((result) => (
              <button
                className="inline-action"
                key={result.id}
                onClick={() => {
                  setNewSiteName(result.label.split(",")[0] ?? "New Site");
                  setNewSiteLat(result.lat);
                  setNewSiteLon(result.lon);
                  addSiteByCoordinates(result.label.split(",")[0] ?? "New Site", result.lat, result.lon);
                }}
                type="button"
              >
                Add: {result.label}
              </button>
            ))}
          </div>
        ) : null}
        {siteLibrary.length ? (
          <div className="asset-list">
            <p className="field-help">Site Library</p>
            {siteLibrary.map((entry) => (
              <div className="library-row" key={entry.id}>
                <span className="library-row-label">
                  {entry.name} ({entry.position.lat.toFixed(4)}, {entry.position.lon.toFixed(4)})
                </span>
                <div className="library-row-actions">
                  <button className="inline-action" onClick={() => insertSiteFromLibrary(entry.id)} type="button">
                    Insert
                  </button>
                  <button
                    className="inline-action"
                    onClick={() => deleteSiteLibraryEntry(entry.id)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel-section">
        <h2>{t(locale, "model")}</h2>
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
        <h2>Channel / Coverage</h2>
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
        <p className="field-help">
          Network is the active channel profile used for coverage + link calculations.
        </p>
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
      </section>

      <section className="panel-section">
        <h2>{t(locale, "links")}</h2>
        <div className="link-list">
          {links.map((link) => (
            <button
              className={clsx("link-item", selectedLinkId === link.id && "is-selected")}
              key={link.id}
              onClick={() => setSelectedLinkId(link.id)}
              type="button"
            >
              <span className="link-title">{(link.name || link.id).toUpperCase()}</span>
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
            type="text"
            value={selectedLink.name ?? ""}
          />
        </label>

        <p className="field-help">Frequency is controlled in Channel / Coverage and shared by all links.</p>

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
      </section>

      <section className="panel-section">
        <h2>{t(locale, "sites")}</h2>
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
          Delete Selected Site
        </button>

        <label className="field-grid">
          <span>Latitude</span>
          <input
            onChange={(event) =>
              updateSite(selectedSite.id, {
                position: { ...selectedSite.position, lat: parseNumber(event.target.value) },
              })
            }
            step="0.0001"
            type="number"
            value={selectedSite.position.lat}
          />
        </label>

        <label className="field-grid">
          <span>Longitude</span>
          <input
            onChange={(event) =>
              updateSite(selectedSite.id, {
                position: { ...selectedSite.position, lon: parseNumber(event.target.value) },
              })
            }
            step="0.0001"
            type="number"
            value={selectedSite.position.lon}
          />
        </label>

        <label className="field-grid">
          <span>Ground elev (m)</span>
          <input
            onChange={(event) =>
              updateSite(selectedSite.id, { groundElevationM: parseNumber(event.target.value) })
            }
            type="number"
            value={selectedSite.groundElevationM}
          />
        </label>

        <label className="field-grid">
          <span>Antenna (m)</span>
          <input
            onChange={(event) =>
              updateSite(selectedSite.id, { antennaHeightM: parseNumber(event.target.value) })
            }
            type="number"
            value={selectedSite.antennaHeightM}
          />
        </label>
      </section>

      <section className="panel-section">
        <h2>{t(locale, "terrainData")}</h2>
        <p>{srtmTiles.length} SRTM tile(s) loaded</p>
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
          Auto Fetch Current Area
        </button>
        <button
          className="inline-action"
          onClick={() => void recommendTerrainDatasetForCurrentArea()}
          type="button"
        >
          Recommend Best Dataset
        </button>
        <button
          className="inline-action"
          onClick={() => void recommendAndFetchTerrainForCurrentArea()}
          type="button"
        >
          Recommend + Fetch
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
      </section>

      <section className="panel-section">
        <h2>{t(locale, "legacyAssets")}</h2>
        <div className="asset-list">
          {LEGACY_ASSETS.map((asset) => (
            <a href={asset.url} key={asset.url} rel="noreferrer" target="_blank">
              {asset.label}
            </a>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h2>{t(locale, "rfSummary")}</h2>
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
    </aside>
  );
}
