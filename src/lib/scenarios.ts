import type { Link, MapViewport, Network, RadioSystem, Site } from "../types/radio";

export type DemoScenario = {
  id: string;
  name: string;
  sites: Site[];
  links: Link[];
  systems: RadioSystem[];
  networks: Network[];
  viewport: MapViewport;
  defaultSiteId: string;
  defaultLinkId: string;
  defaultNetworkId: string;
  defaultFrequencyPresetId: string;
};

const mkSystems = (): RadioSystem[] => [
  {
    id: "sys-base",
    name: "Base",
    txPowerDbm: 22,
    txGainDbi: 5,
    rxGainDbi: 5,
    cableLossDb: 1,
    antennaHeightM: 2,
  },
  {
    id: "sys-mobile",
    name: "Mobile",
    txPowerDbm: 22,
    txGainDbi: 2,
    rxGainDbi: 2,
    cableLossDb: 1,
    antennaHeightM: 2,
  },
];

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "oslo-local",
    name: "Oslo Local Mesh",
    sites: [
      {
        id: "site-bislett",
        name: "Bislett",
        position: { lat: 59.925, lon: 10.732 },
        groundElevationM: 95,
        antennaHeightM: 2,
      },
      {
        id: "site-grefsen",
        name: "Grefsen",
        position: { lat: 59.956, lon: 10.781 },
        groundElevationM: 160,
        antennaHeightM: 2,
      },
      {
        id: "site-nordstrand",
        name: "Nordstrand",
        position: { lat: 59.866, lon: 10.79 },
        groundElevationM: 124,
        antennaHeightM: 2,
      },
    ],
    links: [
      {
        id: "lnk-oslo-1",
        fromSiteId: "site-bislett",
        toSiteId: "site-grefsen",
        frequencyMHz: 869.618,
        txPowerDbm: 22,
        txGainDbi: 5,
        rxGainDbi: 5,
        cableLossDb: 1,
      },
      {
        id: "lnk-oslo-2",
        fromSiteId: "site-bislett",
        toSiteId: "site-nordstrand",
        frequencyMHz: 869.618,
        txPowerDbm: 22,
        txGainDbi: 5,
        rxGainDbi: 5,
        cableLossDb: 1,
      },
    ],
    systems: mkSystems(),
    networks: [
      {
        id: "net-oslo",
        name: "Scenario Channel",
        frequencyMHz: 869.618,
        bandwidthKhz: 62,
        spreadFactor: 8,
        codingRate: 5,
        frequencyOverrideMHz: 869.618,
        regionCode: "EU_868",
        memberships: [
          { siteId: "site-bislett", systemId: "sys-base" },
          { siteId: "site-grefsen", systemId: "sys-mobile" },
          { siteId: "site-nordstrand", systemId: "sys-mobile" },
        ],
      },
    ],
    viewport: {
      center: { lat: 59.915, lon: 10.766 },
      zoom: 10.5,
    },
    defaultSiteId: "site-bislett",
    defaultLinkId: "lnk-oslo-1",
    defaultNetworkId: "net-oslo",
    defaultFrequencyPresetId: "oslo-local-869618",
  },
  {
    id: "oslo-regional",
    name: "Oslo Regional Ring",
    sites: [
      {
        id: "site-sandvika",
        name: "Sandvika",
        position: { lat: 59.891, lon: 10.524 },
        groundElevationM: 20,
        antennaHeightM: 2,
      },
      {
        id: "site-lillestrom",
        name: "Lillestrøm",
        position: { lat: 59.956, lon: 11.05 },
        groundElevationM: 108,
        antennaHeightM: 2,
      },
      {
        id: "site-ski",
        name: "Ski",
        position: { lat: 59.719, lon: 10.835 },
        groundElevationM: 130,
        antennaHeightM: 2,
      },
    ],
    links: [
      {
        id: "lnk-reg-1",
        fromSiteId: "site-sandvika",
        toSiteId: "site-lillestrom",
        frequencyMHz: 869.618,
        txPowerDbm: 22,
        txGainDbi: 5,
        rxGainDbi: 5,
        cableLossDb: 1,
      },
      {
        id: "lnk-reg-2",
        fromSiteId: "site-lillestrom",
        toSiteId: "site-ski",
        frequencyMHz: 869.618,
        txPowerDbm: 22,
        txGainDbi: 5,
        rxGainDbi: 5,
        cableLossDb: 1,
      },
    ],
    systems: mkSystems(),
    networks: [
      {
        id: "net-regional",
        name: "Scenario Channel",
        frequencyMHz: 869.618,
        bandwidthKhz: 62,
        spreadFactor: 8,
        codingRate: 5,
        frequencyOverrideMHz: 869.618,
        regionCode: "EU_868",
        memberships: [
          { siteId: "site-sandvika", systemId: "sys-base" },
          { siteId: "site-lillestrom", systemId: "sys-mobile" },
          { siteId: "site-ski", systemId: "sys-mobile" },
        ],
      },
    ],
    viewport: {
      center: { lat: 59.86, lon: 10.8 },
      zoom: 9.2,
    },
    defaultSiteId: "site-sandvika",
    defaultLinkId: "lnk-reg-1",
    defaultNetworkId: "net-regional",
    defaultFrequencyPresetId: "oslo-local-869618",
  },
];

export const getScenarioById = (id: string): DemoScenario | undefined =>
  DEMO_SCENARIOS.find((scenario) => scenario.id === id);

export const defaultScenario = DEMO_SCENARIOS[0];
