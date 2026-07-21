import {
  Antenna,
  Building2,
  Car,
  House,
  Mountain,
  RadioTower,
  Ship,
  TreePine,
  type LucideIcon,
} from "lucide-react";

export const SITE_ICON_KEYS = [
  "antenna",
  "radio-tower",
  "house",
  "building",
  "mountain",
  "tree",
  "ship",
  "vehicle",
] as const;

export type SiteIconKey = (typeof SITE_ICON_KEYS)[number];

export const SITE_ICON_OPTIONS: ReadonlyArray<{
  key: SiteIconKey;
  label: string;
  Icon: LucideIcon;
}> = [
  { key: "antenna", label: "Antenna", Icon: Antenna },
  { key: "radio-tower", label: "Radio tower", Icon: RadioTower },
  { key: "house", label: "House", Icon: House },
  { key: "building", label: "Building", Icon: Building2 },
  { key: "mountain", label: "Mountain", Icon: Mountain },
  { key: "tree", label: "Tree", Icon: TreePine },
  { key: "ship", label: "Ship", Icon: Ship },
  { key: "vehicle", label: "Vehicle", Icon: Car },
];

const SITE_ICON_KEY_SET = new Set<string>(SITE_ICON_KEYS);
const SITE_ICON_BY_KEY = new Map(SITE_ICON_OPTIONS.map((option) => [option.key, option]));

export const isSiteIconKey = (value: unknown): value is SiteIconKey =>
  typeof value === "string" && SITE_ICON_KEY_SET.has(value);

export const getSiteIconOption = (key: SiteIconKey) => SITE_ICON_BY_KEY.get(key)!;

type SiteIconInput = {
  name: string;
  antennaHeightM: number;
  iconKey?: unknown;
};

const includesKeyword = (tokens: ReadonlySet<string>, keywords: readonly string[]): boolean =>
  keywords.some((keyword) => tokens.has(keyword));

export const suggestSiteIconKey = ({ name, antennaHeightM }: SiteIconInput): SiteIconKey => {
  if (Number.isFinite(antennaHeightM) && antennaHeightM >= 10) return "radio-tower";

  const normalizedName = name.trim().toLocaleLowerCase();
  const tokens = new Set(normalizedName.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  if (includesKeyword(tokens, ["tower", "mast", "repeater", "relay"])) return "radio-tower";
  if (includesKeyword(tokens, ["house", "home", "cabin", "hytte"])) return "house";
  if (includesKeyword(tokens, ["office", "building", "hotel", "school", "roof"])) return "building";
  if (includesKeyword(tokens, ["mount", "mountain", "peak", "summit", "fjell"])) return "mountain";
  if (includesKeyword(tokens, ["tree", "forest", "woods", "woodland"])) return "tree";
  if (includesKeyword(tokens, ["boat", "ship", "vessel", "ferry"])) return "ship";
  if (includesKeyword(tokens, ["car", "truck", "vehicle", "mobile", "van"])) return "vehicle";
  return "antenna";
};

export const resolveSiteIconKey = (site: SiteIconInput): SiteIconKey =>
  isSiteIconKey(site.iconKey) ? site.iconKey : suggestSiteIconKey(site);
