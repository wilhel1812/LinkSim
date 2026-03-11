import { create } from "zustand";
import { buildCoverage } from "../lib/coverage";
import { fetchElevations } from "../lib/elevationService";
import { findPresetById } from "../lib/frequencyPlans";
import { analyzeLink, buildProfile } from "../lib/propagation";
import { DEMO_SCENARIOS, defaultScenario, getScenarioById } from "../lib/scenarios";
import { parseSrtmTile, sampleSrtmElevation } from "../lib/srtm";
import {
  clearVe2dbeCache,
  loadVe2dbeTilesForArea,
  recommendVe2dbeDatasetForArea,
  type TerrainDataset,
} from "../lib/ve2dbeTerrainClient";
import type { LocaleCode } from "../i18n/locales";
import type {
  CoverageMode,
  CoverageSample,
  Link,
  LinkAnalysis,
  MapViewport,
  Network,
  ProfilePoint,
  PropagationModel,
  RadioSystem,
  Site,
  SrtmTile,
} from "../types/radio";

type AppState = {
  sites: Site[];
  links: Link[];
  systems: RadioSystem[];
  networks: Network[];
  srtmTiles: SrtmTile[];
  coverageSamples: CoverageSample[];
  selectedLinkId: string;
  profileCursorIndex: number;
  selectedSiteId: string;
  selectedNetworkId: string;
  selectedCoverageMode: CoverageMode;
  propagationModel: PropagationModel;
  mapViewport: MapViewport;
  locale: LocaleCode;
  selectedScenarioId: string;
  selectedFrequencyPresetId: string;
  rxSensitivityTargetDbm: number;
  terrainDataset: TerrainDataset;
  terrainFetchStatus: string;
  terrainRecommendation: string;
  hasOnlineElevationSync: boolean;
  endpointPickTarget: "from" | "to" | null;
  scenarioOptions: { id: string; name: string }[];
  setLocale: (locale: LocaleCode) => void;
  selectScenario: (id: string) => void;
  setSelectedLinkId: (id: string) => void;
  setProfileCursorIndex: (index: number) => void;
  setSelectedSiteId: (id: string) => void;
  setSelectedNetworkId: (id: string) => void;
  setSelectedCoverageMode: (mode: CoverageMode) => void;
  setSelectedFrequencyPresetId: (id: string) => void;
  setRxSensitivityTargetDbm: (value: number) => void;
  setTerrainDataset: (dataset: TerrainDataset) => void;
  setEndpointPickTarget: (target: "from" | "to" | null) => void;
  applyFrequencyPresetToSelectedNetwork: () => void;
  setPropagationModel: (model: PropagationModel) => void;
  updateSite: (id: string, patch: Partial<Site>) => void;
  updateLink: (id: string, patch: Partial<Link>) => void;
  updateMapViewport: (patch: Partial<MapViewport>) => void;
  ingestSrtmFiles: (files: FileList | File[]) => Promise<void>;
  recommendTerrainDatasetForCurrentArea: () => Promise<void>;
  fetchTerrainForCurrentArea: () => Promise<void>;
  recommendAndFetchTerrainForCurrentArea: () => Promise<void>;
  clearTerrainCache: () => Promise<void>;
  syncSiteElevationsOnline: () => Promise<void>;
  recomputeCoverage: () => void;
  getSelectedLink: () => Link;
  getSelectedSite: () => Site;
  getSelectedNetwork: () => Network;
  getSelectedSites: () => { fromSite: Site; toSite: Site };
  getSelectedAnalysis: () => LinkAnalysis;
  getSelectedProfile: () => ProfilePoint[];
};

const areaBoundsForSites = (sites: Site[]) => {
  const lats = sites.map((site) => site.position.lat);
  const lons = sites.map((site) => site.position.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latPad = 0.15;
  const lonPad = 0.15;
  const latSpan = Math.min(5, maxLat - minLat + latPad * 2);
  const lonSpan = Math.min(5, maxLon - minLon + lonPad * 2);
  const latCenter = (minLat + maxLat) / 2;
  const lonCenter = (minLon + maxLon) / 2;
  return {
    minLat: latCenter - latSpan / 2,
    maxLat: latCenter + latSpan / 2,
    minLon: lonCenter - lonSpan / 2,
    maxLon: lonCenter + lonSpan / 2,
  };
};

export const useAppStore = create<AppState>((set, get) => ({
  sites: defaultScenario.sites,
  links: defaultScenario.links,
  systems: defaultScenario.systems,
  networks: defaultScenario.networks,
  srtmTiles: [],
  coverageSamples: [],
  selectedLinkId: defaultScenario.defaultLinkId,
  profileCursorIndex: 0,
  selectedSiteId: defaultScenario.defaultSiteId,
  selectedNetworkId: defaultScenario.defaultNetworkId,
  selectedCoverageMode: "BestSite",
  propagationModel: "FSPL",
  mapViewport: defaultScenario.viewport,
  locale: "eng",
  selectedScenarioId: defaultScenario.id,
  selectedFrequencyPresetId: defaultScenario.defaultFrequencyPresetId,
  rxSensitivityTargetDbm: -120,
  terrainDataset: "srtm1",
  terrainFetchStatus: "",
  terrainRecommendation: "",
  hasOnlineElevationSync: false,
  endpointPickTarget: null,
  scenarioOptions: DEMO_SCENARIOS.map((scenario) => ({ id: scenario.id, name: scenario.name })),
  setLocale: (locale) => set({ locale }),
  selectScenario: (id) => {
    const scenario = getScenarioById(id);
    if (!scenario) return;
    set({
      selectedScenarioId: scenario.id,
      sites: scenario.sites,
      links: scenario.links,
      systems: scenario.systems,
      networks: scenario.networks,
      selectedSiteId: scenario.defaultSiteId,
      selectedLinkId: scenario.defaultLinkId,
      profileCursorIndex: 0,
      selectedNetworkId: scenario.defaultNetworkId,
      selectedFrequencyPresetId: scenario.defaultFrequencyPresetId,
      rxSensitivityTargetDbm: -120,
      terrainFetchStatus: "",
      terrainRecommendation: "",
      hasOnlineElevationSync: false,
      endpointPickTarget: null,
      mapViewport: scenario.viewport,
    });
    get().recomputeCoverage();
  },
  setSelectedLinkId: (id) => set({ selectedLinkId: id, profileCursorIndex: 0 }),
  setProfileCursorIndex: (index) => set({ profileCursorIndex: Math.max(0, Math.floor(index)) }),
  setSelectedSiteId: (id) => set({ selectedSiteId: id }),
  setSelectedNetworkId: (id) => {
    set({ selectedNetworkId: id });
    get().recomputeCoverage();
  },
  setSelectedCoverageMode: (mode) => {
    set({ selectedCoverageMode: mode });
    get().recomputeCoverage();
  },
  setSelectedFrequencyPresetId: (id) => set({ selectedFrequencyPresetId: id }),
  setRxSensitivityTargetDbm: (value) => set({ rxSensitivityTargetDbm: value }),
  setTerrainDataset: (dataset) => set({ terrainDataset: dataset }),
  setEndpointPickTarget: (target) => set({ endpointPickTarget: target }),
  applyFrequencyPresetToSelectedNetwork: () => {
    const { selectedFrequencyPresetId, selectedNetworkId } = get();
    const preset = findPresetById(selectedFrequencyPresetId);
    if (!preset) return;

    set((state) => ({
      networks: state.networks.map((network) =>
        network.id === selectedNetworkId
          ? {
              ...network,
              frequencyMHz: preset.frequencyMHz,
              bandwidthKhz: preset.bandwidthKhz,
              spreadFactor: preset.spreadFactor,
              codingRate: preset.codingRate,
              frequencyOverrideMHz: preset.frequencyMHz,
              regionCode: preset.regionCode,
            }
          : network,
      ),
      links: state.links.map((link) => ({ ...link, frequencyMHz: preset.frequencyMHz })),
    }));
    get().recomputeCoverage();
  },
  setPropagationModel: (model) => {
    set({ propagationModel: model });
    get().recomputeCoverage();
  },
  updateSite: (id, patch) => {
    set((state) => ({
      sites: state.sites.map((site) => (site.id === id ? { ...site, ...patch } : site)),
    }));
    get().recomputeCoverage();
  },
  updateLink: (id, patch) => {
    set((state) => ({
      links: state.links.map((link) => {
        if (link.id !== id) return link;
        const next = { ...link, ...patch };

        if (next.fromSiteId === next.toSiteId) {
          const alternative = state.sites.find((site) => site.id !== next.fromSiteId);
          if (alternative) {
            if ("fromSiteId" in patch && !("toSiteId" in patch)) {
              next.toSiteId = alternative.id;
            } else {
              next.fromSiteId = alternative.id;
            }
          }
        }

        return next;
      }),
    }));
    get().recomputeCoverage();
  },
  updateMapViewport: (patch) =>
    set((state) => ({
      mapViewport: {
        ...state.mapViewport,
        ...patch,
        center: {
          ...state.mapViewport.center,
          ...(patch.center ?? {}),
        },
      },
    })),
  ingestSrtmFiles: async (files) => {
    const list = Array.from(files);
    const parsed = await Promise.all(
      list.map(async (file) => {
        const tile = await parseSrtmTile(file);
        return {
          ...tile,
          sourceKind: "manual-upload" as const,
          sourceId: "manual-upload",
          sourceLabel: "Manual upload",
          sourceDetail: file.name,
        };
      }),
    );

    set((state) => {
      const dedup = new Map<string, SrtmTile>();
      for (const tile of state.srtmTiles) dedup.set(tile.key, tile);
      for (const tile of parsed) dedup.set(tile.key, tile);
      return { srtmTiles: Array.from(dedup.values()) };
    });
    get().recomputeCoverage();
  },
  recommendTerrainDatasetForCurrentArea: async () => {
    const { sites } = get();
    if (!sites.length) return;

    const bounds = areaBoundsForSites(sites);

    set({ terrainRecommendation: "Evaluating ve2dbe coverage..." });
    try {
      const recommendation = await recommendVe2dbeDatasetForArea(
        bounds.minLat,
        bounds.maxLat,
        bounds.minLon,
        bounds.maxLon,
      );
      const perDataset = [
        `SRTM Third: ${Math.round(recommendation.byDataset.srtmthird.completeness * 100)}% (${recommendation.byDataset.srtmthird.availableTiles}/${recommendation.expectedTiles})`,
        `SRTM1: ${Math.round(recommendation.byDataset.srtm1.completeness * 100)}% (${recommendation.byDataset.srtm1.availableTiles}/${recommendation.expectedTiles})`,
        `SRTM3: ${Math.round(recommendation.byDataset.srtm3.completeness * 100)}% (${recommendation.byDataset.srtm3.availableTiles}/${recommendation.expectedTiles})`,
      ].join(" | ");
      set({
        terrainDataset: recommendation.dataset,
        terrainRecommendation: `Recommended: ${recommendation.dataset.toUpperCase()} (${Math.round(recommendation.completeness * 100)}%, ${recommendation.availableTiles}/${recommendation.expectedTiles}). ${perDataset}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ terrainRecommendation: `Recommendation failed: ${message}` });
    }
  },
  fetchTerrainForCurrentArea: async () => {
    const { sites, terrainDataset } = get();
    if (!sites.length) return;

    const bounds = areaBoundsForSites(sites);

    set({ terrainFetchStatus: `Fetching ${terrainDataset.toUpperCase()} tiles from ve2dbe...` });

    try {
      const result = await loadVe2dbeTilesForArea(
        bounds.minLat,
        bounds.maxLat,
        bounds.minLon,
        bounds.maxLon,
        terrainDataset,
      );
      set((state) => {
        const dedup = new Map<string, SrtmTile>();
        for (const tile of state.srtmTiles) dedup.set(tile.key, tile);
        for (const tile of result.tiles) dedup.set(tile.key, tile);
        const statusParts = [
          `Loaded ${result.tiles.length} tile(s)`,
          result.fetchedArchives.length ? `${result.fetchedArchives.length} fetched` : "",
          result.cacheHits.length ? `${result.cacheHits.length} from cache` : "",
          result.failedArchives.length ? `${result.failedArchives.length} failed` : "",
        ].filter(Boolean);
        return {
          srtmTiles: Array.from(dedup.values()),
          terrainFetchStatus: `${statusParts.join(", ")} from ve2dbe ${terrainDataset}.${result.failedArchives.length ? ` Missing: ${result.failedArchives.slice(0, 4).join(", ")}${result.failedArchives.length > 4 ? "..." : ""}` : ""}`,
        };
      });
      get().recomputeCoverage();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ terrainFetchStatus: `Terrain fetch failed: ${message}` });
    }
  },
  recommendAndFetchTerrainForCurrentArea: async () => {
    await get().recommendTerrainDatasetForCurrentArea();
    await get().fetchTerrainForCurrentArea();
  },
  clearTerrainCache: async () => {
    await clearVe2dbeCache();
    set((state) => ({
      srtmTiles: state.srtmTiles.filter((tile) => tile.sourceKind === "manual-upload"),
      terrainFetchStatus: "ve2dbe cache cleared.",
    }));
    get().recomputeCoverage();
  },
  syncSiteElevationsOnline: async () => {
    const sites = get().sites;
    const elevations = await fetchElevations(sites.map((site) => site.position));

    set((state) => ({
      sites: state.sites.map((site, index) => ({
        ...site,
        groundElevationM: Number.isFinite(elevations[index])
          ? Math.round(elevations[index])
          : site.groundElevationM,
      })),
      hasOnlineElevationSync: true,
    }));
  },
  recomputeCoverage: () => {
    const { selectedCoverageMode, networks, selectedNetworkId, sites, systems, propagationModel, srtmTiles } = get();
    const network = networks.find((n) => n.id === selectedNetworkId);
    if (!network) {
      set({ coverageSamples: [] });
      return;
    }

    const coverageSamples = buildCoverage(
      selectedCoverageMode,
      network,
      sites,
      systems,
      propagationModel,
      ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
    );
    set({ coverageSamples });
  },
  getSelectedLink: () => {
    const { links, selectedLinkId } = get();
    const link = links.find((candidate) => candidate.id === selectedLinkId);
    if (!link) throw new Error(`Selected link ${selectedLinkId} not found`);
    return link;
  },
  getSelectedSite: () => {
    const { sites, selectedSiteId } = get();
    const site = sites.find((candidate) => candidate.id === selectedSiteId);
    if (!site) throw new Error(`Selected site ${selectedSiteId} not found`);
    return site;
  },
  getSelectedNetwork: () => {
    const { networks, selectedNetworkId } = get();
    const network = networks.find((candidate) => candidate.id === selectedNetworkId);
    if (!network) throw new Error(`Selected network ${selectedNetworkId} not found`);
    return network;
  },
  getSelectedSites: () => {
    const { sites, getSelectedLink } = get();
    const link = getSelectedLink();
    const fromSite = sites.find((s) => s.id === link.fromSiteId);
    const toSite = sites.find((s) => s.id === link.toSiteId);
    if (!fromSite || !toSite) throw new Error(`Sites for link ${link.id} not found`);
    return { fromSite, toSite };
  },
  getSelectedAnalysis: () => {
    const { getSelectedLink, getSelectedSites, propagationModel, srtmTiles } = get();
    const link = getSelectedLink();
    const { fromSite, toSite } = getSelectedSites();
    return analyzeLink(
      link,
      fromSite,
      toSite,
      propagationModel,
      ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
    );
  },
  getSelectedProfile: () => {
    const { getSelectedLink, getSelectedSites, srtmTiles } = get();
    const link = getSelectedLink();
    const { fromSite, toSite } = getSelectedSites();

    return buildProfile(
      link,
      fromSite,
      toSite,
      ({ lat, lon }) => sampleSrtmElevation(srtmTiles, lat, lon),
      120,
    );
  },
}));

useAppStore.getState().recomputeCoverage();
