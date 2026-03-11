import type { ChangeEvent } from "react";
import clsx from "clsx";
import { t, LOCALE_LABELS, SUPPORTED_LOCALES } from "../i18n/locales";
import { FREQUENCY_PRESETS } from "../lib/frequencyPlans";
import { LEGACY_ASSETS } from "../lib/legacyAssets";
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
  const selectedLinkId = useAppStore((state) => state.selectedLinkId);
  const selectedSiteId = useAppStore((state) => state.selectedSiteId);
  const selectedNetworkId = useAppStore((state) => state.selectedNetworkId);
  const selectedCoverageMode = useAppStore((state) => state.selectedCoverageMode);
  const selectedFrequencyPresetId = useAppStore((state) => state.selectedFrequencyPresetId);
  const rxSensitivityTargetDbm = useAppStore((state) => state.rxSensitivityTargetDbm);
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
  const fromSite = sites.find((site) => site.id === selectedLink.fromSiteId);
  const toSite = sites.find((site) => site.id === selectedLink.toSiteId);
  const fromSiteChoices = sites.filter((site) => site.id !== selectedLink.toSiteId);
  const toSiteChoices = sites.filter((site) => site.id !== selectedLink.fromSiteId);
  const canEditEndpoints = sites.length >= 2;
  const sourceSite = sites.find((site) => site.id === selectedLink.fromSiteId);
  const destinationSite = sites.find((site) => site.id === selectedLink.toSiteId);
  const linkMarginDb = analysis.rxLevelDbm - rxSensitivityTargetDbm;
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
      { ...selectedLink, txPowerDbm: selectedLink.txPowerDbm + txPowerDeltaDbm, frequencyMHz: selectedLink.frequencyMHz * freqScale },
      { ...sourceSite, antennaHeightM: sourceSite.antennaHeightM + antennaDeltaM },
      { ...destinationSite, antennaHeightM: destinationSite.antennaHeightM + antennaDeltaM },
      model,
      ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
    );
    return alt.rxLevelDbm;
  };

  const whatIfRows = [
    { label: "Current", rxDbm: analysis.rxLevelDbm },
    { label: "+3 dB TX", rxDbm: runWhatIf(3, 1, 0) },
    { label: "+6 dB TX", rxDbm: runWhatIf(6, 1, 0) },
    { label: "+10 m antennas", rxDbm: runWhatIf(0, 1, 10) },
    { label: "Freq -10%", rxDbm: runWhatIf(0, 0.9, 0) },
    { label: "Freq +10%", rxDbm: runWhatIf(0, 1.1, 0) },
  ].map((row) => ({
    ...row,
    marginDb: row.rxDbm === null ? null : row.rxDbm - rxSensitivityTargetDbm,
  }));

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
      hasOnlineElevationSync: useAppStore.getState().hasOnlineElevationSync,
      terrainTileCount: srtmTiles.length,
      terrainSources,
      selectedAnalysis: analysis,
      linkBudget: {
        targetSensitivityDbm: rxSensitivityTargetDbm,
        marginDb: linkMarginDb,
        whatIfRows,
      },
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadJson(`radio-mobile-web-manifest-${stamp}.json`, manifest);
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
        <h2>Scenario</h2>
        <select
          className="locale-select"
          onChange={(event) => selectScenario(event.target.value)}
          value={selectedScenarioId}
        >
          {scenarioOptions.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.name}
            </option>
          ))}
        </select>
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
        <h2>Network</h2>
        <select
          className="locale-select"
          onChange={(event) => setSelectedNetworkId(event.target.value)}
          value={selectedNetworkId}
        >
          {networks.map((network) => (
            <option key={network.id} value={network.id}>
              {network.name} ({network.frequencyMHz} MHz)
            </option>
          ))}
        </select>
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
              <span className="link-title">{link.id.toUpperCase()}</span>
              <span className="link-subtitle">{link.frequencyMHz} MHz</span>
            </button>
          ))}
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
          <span>Frequency (MHz)</span>
          <input
            onChange={(event) =>
              updateLink(selectedLink.id, { frequencyMHz: parseNumber(event.target.value) })
            }
            type="number"
            value={selectedLink.frequencyMHz}
          />
        </label>

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
          {metric("RX estimate", `${analysis.rxLevelDbm.toFixed(1)} dBm`)}
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
