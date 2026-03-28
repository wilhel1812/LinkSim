import { useMemo } from "react";
import clsx from "clsx";
import { FREQUENCY_PRESETS } from "../lib/frequencyPlans";
import { deriveDynamicPropagationEnvironment } from "../lib/propagationEnvironment";
import { analyzeLink } from "../lib/propagation";
import { resolveLinkRadio } from "../lib/linkRadio";
import { sampleSrtmElevation } from "../lib/srtm";
import { useAppStore } from "../store/appStore";
import type { PropagationEnvironment } from "../types/radio";
import { InfoTip } from "./InfoTip";

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

export function SimulationResultsSection() {
  const links = useAppStore((state) => state.links);
  const sites = useAppStore((state) => state.sites);
  const srtmTiles = useAppStore((state) => state.srtmTiles);
  const selectedLinkId = useAppStore((state) => state.selectedLinkId);
  const selectedSiteId = useAppStore((state) => state.selectedSiteId);
  const selectedNetworkId = useAppStore((state) => state.selectedNetworkId);
  const selectedCoverageMode = useAppStore((state) => state.selectedCoverageMode);
  const selectedFrequencyPresetId = useAppStore((state) => state.selectedFrequencyPresetId);
  const rxSensitivityTargetDbm = useAppStore((state) => state.rxSensitivityTargetDbm);
  const environmentLossDb = useAppStore((state) => state.environmentLossDb);
  const propagationEnvironment = useAppStore((state) => state.propagationEnvironment);
  const autoPropagationEnvironment = useAppStore((state) => state.autoPropagationEnvironment);
  const propagationEnvironmentReason = useAppStore((state) => state.propagationEnvironmentReason);
  const selectedScenarioId = useAppStore((state) => state.selectedScenarioId);
  const temporaryDirectionReversed = useAppStore((state) => state.temporaryDirectionReversed);
  const locale = useAppStore((state) => state.locale);
  const networks = useAppStore((state) => state.networks);
  const setRxSensitivityTargetDbm = useAppStore((state) => state.setRxSensitivityTargetDbm);
  const setEnvironmentLossDb = useAppStore((state) => state.setEnvironmentLossDb);
  const terrainDataset = useAppStore((state) => state.terrainDataset);
  const terrainFetchStatus = useAppStore((state) => state.terrainFetchStatus);
  const terrainRecommendation = useAppStore((state) => state.terrainRecommendation);
  const getSelectedAnalysis = useAppStore((state) => state.getSelectedAnalysis);
  const getSelectedLink = useAppStore((state) => state.getSelectedLink);
  const getSelectedNetwork = useAppStore((state) => state.getSelectedNetwork);
  const model = useAppStore((state) => state.propagationModel);

  const selectedLink = useMemo(
    () => getSelectedLink(),
    [getSelectedLink, links, selectedLinkId, sites, networks, selectedNetworkId],
  );
  const selectedNetwork = useMemo(
    () => getSelectedNetwork(),
    [getSelectedNetwork, networks, selectedNetworkId],
  );
  const analysis = useMemo(
    () => getSelectedAnalysis(),
    [
      getSelectedAnalysis,
      links,
      selectedLinkId,
      sites,
      selectedSiteId,
      networks,
      selectedNetworkId,
      model,
      srtmTiles,
      autoPropagationEnvironment,
      propagationEnvironment,
      temporaryDirectionReversed,
    ],
  );
  const effectiveNetworkFrequencyMHz = selectedNetwork.frequencyOverrideMHz ?? selectedNetwork.frequencyMHz;
  const selectedFrequencyPreset = FREQUENCY_PRESETS.find((preset) => preset.id === selectedFrequencyPresetId);
  const isLoraEstimateRelevant = (selectedFrequencyPreset?.source ?? "Meshtastic") !== "RadioMobile";
  const sourceSite = sites.find((site) => site.id === selectedLink.fromSiteId);
  const destinationSite = sites.find((site) => site.id === selectedLink.toSiteId);
  const adjustedRxDbm = analysis.rxLevelDbm - environmentLossDb;
  const linkMarginDb = adjustedRxDbm - rxSensitivityTargetDbm;
  const loraSensitivitySuggestionDbm = estimateLoRaSensitivityDbm(
    selectedNetwork.bandwidthKhz,
    selectedNetwork.spreadFactor,
  );
  const effectivePropagationEnvironment = useMemo(() => {
    if (!autoPropagationEnvironment || !sourceSite || !destinationSite) return propagationEnvironment;
    return deriveDynamicPropagationEnvironment({
      from: sourceSite.position,
      to: destinationSite.position,
      fromGroundM: sourceSite.groundElevationM,
      toGroundM: destinationSite.groundElevationM,
      terrainSampler: ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
    }).environment;
  }, [autoPropagationEnvironment, sourceSite, destinationSite, propagationEnvironment, srtmTiles]);

  const runWhatIf = (txPowerDeltaDbm = 0, freqScale = 1, antennaDeltaM = 0): number | null => {
    if (!sourceSite || !destinationSite) return null;
    const effectiveRadio = resolveLinkRadio(selectedLink, sourceSite, destinationSite);
    const alt = analyzeLink(
      {
        ...selectedLink,
        txPowerDbm: effectiveRadio.txPowerDbm + txPowerDeltaDbm,
        frequencyMHz: effectiveNetworkFrequencyMHz * freqScale,
      },
      { ...sourceSite, antennaHeightM: sourceSite.antennaHeightM + antennaDeltaM },
      { ...destinationSite, antennaHeightM: destinationSite.antennaHeightM + antennaDeltaM },
      model,
      ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
      { environment: effectivePropagationEnvironment as PropagationEnvironment },
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
      autoPropagationEnvironment,
      propagationEnvironment: effectivePropagationEnvironment,
      propagationEnvironmentReason,
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
    downloadJson(`linksim-manifest-${stamp}.json`, manifest);
  };

  return (
    <>
      <div className="section-heading">
        <h2>Results</h2>
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
        {metric(
          "LOS status",
          analysis.model === "ITM" ? (analysis.terrainObstructed ? "Blocked" : "Clear") : "Model ignores terrain",
        )}
        {metric("Earth bulge", `${analysis.midpointEarthBulgeM.toFixed(2)} m`)}
        {metric("F1 radius", `${analysis.firstFresnelRadiusM.toFixed(2)} m`)}
        {metric("Clearance", `${analysis.geometricClearanceM.toFixed(2)} m`)}
        {metric("Fresnel clearance (midpoint est.)", `${analysis.estimatedFresnelClearancePercent.toFixed(0)}%`)}
        {metric("Worst Fresnel clearance", `${analysis.worstFresnelClearancePercent.toFixed(0)}%`)}
        {metric("Worst Fresnel gap", `${analysis.worstFresnelClearanceM.toFixed(2)} m`)}
        {metric("Worst Fresnel point", `${analysis.worstFresnelDistanceKm.toFixed(2)} km`)}
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
      {isLoraEstimateRelevant ? (
        <div className="section-heading">
          <button
            className="inline-action"
            onClick={() => setRxSensitivityTargetDbm(Math.round(loraSensitivitySuggestionDbm))}
            type="button"
          >
            Set RX Target To LoRa Estimate ({loraSensitivitySuggestionDbm.toFixed(1)} dBm)
          </button>
          <InfoTip text="Sets RX target to a LoRa sensitivity estimate from current BW and SF (noise floor + NF + SF SNR limit). This is a helper target, not a measured receiver spec." />
        </div>
      ) : (
        <p className="field-help">
          LoRa RX estimate helper is hidden for Radio Mobile presets. Switch to a Meshtastic/Local frequency plan to
          use it.
        </p>
      )}
      <div className="section-heading">
        <div className={clsx("margin-status", linkMarginDb >= 0 ? "is-pass" : "is-fail")}>
          Link margin: {linkMarginDb >= 0 ? "+" : ""}
          {linkMarginDb.toFixed(1)} dB ({linkMarginDb >= 0 ? "PASS" : "FAIL"})
        </div>
        <InfoTip text="Pass/Fail compares calibrated RX estimate to the signal target. In map view: green = clear path + meets signal target, yellow = blocked path + meets signal target, orange = clear path + below signal target, red = blocked path + below signal target. LOS blocking colors apply when ITM + terrain data are in use." />
      </div>
      <div className="whatif-table">
        {whatIfRows.map((row) => (
          <div className="whatif-row" key={row.label}>
            <span>{row.label}</span>
            <span>{row.rxDbm === null ? "n/a" : `${row.rxDbm.toFixed(1)} dBm`}</span>
            <span>{row.marginDb === null ? "n/a" : `${row.marginDb >= 0 ? "+" : ""}${row.marginDb.toFixed(1)} dB`}</span>
          </div>
        ))}
      </div>
      <button className="inline-action" onClick={exportManifest} type="button">
        Export Simulation Manifest
      </button>
    </>
  );
}
