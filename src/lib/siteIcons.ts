import {
  Antenna,
  Building2,
  Car,
  House,
  Leaf,
  Mountain,
  Radio,
  RadioReceiver,
  RadioTower,
  SatelliteDish,
  Ship,
  Smartphone,
  SolarPanel,
  Thermometer,
  TreePine,
  type LucideIcon,
} from "lucide-react";

export const SITE_ICON_KEYS = [
  "antenna",
  "satellite-dish",
  "radio-tower",
  "house",
  "building",
  "mountain",
  "tree",
  "ship",
  "vehicle",
  "solar-panel",
  "radio-receiver",
  "radio",
  "smartphone",
  "thermometer",
  "leaf",
] as const;

export type SiteIconKey = (typeof SITE_ICON_KEYS)[number];

export const SITE_ICON_OPTIONS: ReadonlyArray<{
  key: SiteIconKey;
  label: string;
  Icon: LucideIcon;
}> = [
  { key: "antenna", label: "Antenna", Icon: Antenna },
  { key: "satellite-dish", label: "Satellite Dish", Icon: SatelliteDish },
  { key: "radio-tower", label: "Radio Tower", Icon: RadioTower },
  { key: "house", label: "House", Icon: House },
  { key: "building", label: "Building 2", Icon: Building2 },
  { key: "mountain", label: "Mountain", Icon: Mountain },
  { key: "tree", label: "Tree Pine", Icon: TreePine },
  { key: "ship", label: "Ship", Icon: Ship },
  { key: "vehicle", label: "Car", Icon: Car },
  { key: "solar-panel", label: "Solar Panel", Icon: SolarPanel },
  { key: "radio-receiver", label: "Radio Receiver", Icon: RadioReceiver },
  { key: "radio", label: "Radio", Icon: Radio },
  { key: "smartphone", label: "Smartphone", Icon: Smartphone },
  { key: "thermometer", label: "Thermometer", Icon: Thermometer },
  { key: "leaf", label: "Leaf", Icon: Leaf },
];

const SITE_ICON_KEY_SET = new Set<string>(SITE_ICON_KEYS);
const SITE_ICON_BY_KEY = new Map(SITE_ICON_OPTIONS.map((option) => [option.key, option]));

export const isSiteIconKey = (value: unknown): value is SiteIconKey =>
  typeof value === "string" && SITE_ICON_KEY_SET.has(value);

export const getSiteIconOption = (key: SiteIconKey) => SITE_ICON_BY_KEY.get(key)!;

type SiteIconInput = {
  name: string;
  antennaHeightM: number;
  antennaMode?: "omnidirectional" | "directional";
  iconKey?: unknown;
};

const includesKeyword = (tokens: ReadonlySet<string>, keywords: readonly string[]): boolean =>
  keywords.some((keyword) => tokens.has(keyword));

export const suggestSiteIconKey = ({ name, antennaHeightM, antennaMode }: SiteIconInput): SiteIconKey => {
  if (antennaMode === "directional") return "satellite-dish";
  if (Number.isFinite(antennaHeightM) && antennaHeightM >= 10) return "radio-tower";

  const normalizedName = name.trim().toLocaleLowerCase();
  const tokens = new Set(normalizedName.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  if (includesKeyword(tokens, ["tower", "mast", "repeater", "relay"])) return "radio-tower";
  if (includesKeyword(tokens, ["solar", "photovoltaic", "pv"])) return "solar-panel";
  if (includesKeyword(tokens, ["computer", "desktop", "laptop", "pc"])) return "radio-receiver";
  if (includesKeyword(tokens, ["pocket", "phone", "smartphone", "handheld"])) return "smartphone";
  if (includesKeyword(tokens, ["sensor", "temperature", "weather", "thermometer"])) return "thermometer";
  if (includesKeyword(tokens, ["leaf"])) return "leaf";
  if (includesKeyword(tokens, ["house", "home", "cabin", "hytte"])) return "house";
  if (includesKeyword(tokens, ["office", "building", "hotel", "school", "roof"])) return "building";
  if (includesKeyword(tokens, ["mount", "mountain", "peak", "summit", "fjell"])) return "mountain";
  if (includesKeyword(tokens, ["tree", "forest", "woods", "woodland"])) return "tree";
  if (includesKeyword(tokens, ["boat", "ship", "vessel", "ferry"])) return "ship";
  if (includesKeyword(tokens, ["car", "truck", "vehicle", "mobile", "van"])) return "vehicle";
  return "radio";
};

export const resolveSiteIconKey = (site: SiteIconInput): SiteIconKey =>
  isSiteIconKey(site.iconKey) ? site.iconKey : suggestSiteIconKey(site);
