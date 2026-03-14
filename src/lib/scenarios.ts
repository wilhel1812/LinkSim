import type { Link, MapViewport, Network, RadioSystem, Site } from "../types/radio";

export type BuiltinScenario = {
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

export const BUILTIN_SCENARIOS: BuiltinScenario[] = [
  {
    id: "workspace-starter",
    name: "Starter Workspace",
    sites: [
      {
        id: "site-a",
        name: "Site A",
        position: { lat: 59.92, lon: 10.75 },
        groundElevationM: 100,
        antennaHeightM: 2,
        txPowerDbm: 22,
        txGainDbi: 5,
        rxGainDbi: 5,
        cableLossDb: 1,
      },
      {
        id: "site-b",
        name: "Site B",
        position: { lat: 59.95, lon: 10.82 },
        groundElevationM: 120,
        antennaHeightM: 2,
        txPowerDbm: 22,
        txGainDbi: 2,
        rxGainDbi: 2,
        cableLossDb: 1,
      },
    ],
    links: [
      {
        id: "lnk-starter-1",
        fromSiteId: "site-a",
        toSiteId: "site-b",
        frequencyMHz: 869.618,
      },
    ],
    systems: mkSystems(),
    networks: [
      {
        id: "net-starter",
        name: "Scenario Channel",
        frequencyMHz: 869.618,
        bandwidthKhz: 62,
        spreadFactor: 8,
        codingRate: 5,
        frequencyOverrideMHz: 869.618,
        regionCode: "EU_868",
        memberships: [
          { siteId: "site-a", systemId: "sys-base" },
          { siteId: "site-b", systemId: "sys-mobile" },
        ],
      },
    ],
    viewport: {
      center: { lat: 59.935, lon: 10.785 },
      zoom: 10.2,
    },
    defaultSiteId: "site-a",
    defaultLinkId: "lnk-starter-1",
    defaultNetworkId: "net-starter",
    defaultFrequencyPresetId: "oslo-local-869618",
  },
];

export const getScenarioById = (id: string): BuiltinScenario | undefined =>
  BUILTIN_SCENARIOS.find((scenario) => scenario.id === id);

export const defaultScenario = BUILTIN_SCENARIOS[0];
