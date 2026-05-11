import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

type UserRow = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  created_at: string;
};

type ResourceRow = {
  id: string;
  owner_user_id: string;
  created_at: string | null;
  payload_json: string;
};

type GrowthBucket = {
  label: string;
  users: number;
  sites: number;
  simulations: number;
  links: number;
  cumulativeUsers: number;
  cumulativeSites: number;
  cumulativeSimulations: number;
  cumulativeLinks: number;
};

type SitePayload = {
  position?: {
    lat?: unknown;
    lon?: unknown;
  };
};

type SimulationPayload = {
  snapshot?: {
    sites?: unknown;
    links?: unknown;
  };
};

const CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=3600";

const parseJsonObject = <T>(raw: string): T | null => {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
};

const parseDate = (value: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const monthLabel = (date: Date): string =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

const weekLabel = (date: Date): string => {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = start.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setUTCDate(start.getUTCDate() + diff);
  return start.toISOString().slice(0, 10);
};

type GrowthCountKey = "users" | "sites" | "simulations" | "links";
type GrowthCounts = Record<GrowthCountKey, number>;

const emptyGrowthCounts = (): GrowthCounts => ({ users: 0, sites: 0, simulations: 0, links: 0 });

const increment = (map: Map<string, GrowthCounts>, label: string, key: GrowthCountKey, amount = 1) => {
  const current = map.get(label) ?? emptyGrowthCounts();
  current[key] += amount;
  map.set(label, current);
};

const simulationLinkCount = (simulation: ResourceRow): number => {
  const payload = parseJsonObject<SimulationPayload>(simulation.payload_json);
  return Array.isArray(payload?.snapshot?.links) ? payload.snapshot.links.length : 0;
};

const buildGrowth = (
  users: UserRow[],
  sites: ResourceRow[],
  simulations: ResourceRow[],
  labelFor: (date: Date) => string,
): GrowthBucket[] => {
  const buckets = new Map<string, GrowthCounts>();
  users.forEach((row) => {
    const date = parseDate(row.created_at);
    if (date) increment(buckets, labelFor(date), "users");
  });
  sites.forEach((row) => {
    const date = parseDate(row.created_at);
    if (date) increment(buckets, labelFor(date), "sites");
  });
  simulations.forEach((row) => {
    const date = parseDate(row.created_at);
    if (!date) return;
    const label = labelFor(date);
    increment(buckets, label, "simulations");
    increment(buckets, label, "links", simulationLinkCount(row));
  });

  let cumulativeUsers = 0;
  let cumulativeSites = 0;
  let cumulativeSimulations = 0;
  let cumulativeLinks = 0;
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, counts]) => {
      cumulativeUsers += counts.users;
      cumulativeSites += counts.sites;
      cumulativeSimulations += counts.simulations;
      cumulativeLinks += counts.links;
      return {
        label,
        ...counts,
        cumulativeUsers,
        cumulativeSites,
        cumulativeSimulations,
        cumulativeLinks,
      };
    });
};

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const average = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const round1 = (value: number): number => Math.round(value * 10) / 10;

const bucketSimulationSize = (siteCount: number): "1-2" | "3-5" | "6-10" | "11+" => {
  if (siteCount <= 2) return "1-2";
  if (siteCount <= 5) return "3-5";
  if (siteCount <= 10) return "6-10";
  return "11+";
};

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const [usersResult, sitesResult, simulationsResult] = await Promise.all([
      env.DB.prepare("SELECT id, username, avatar_url, created_at FROM users").all<UserRow>(),
      env.DB.prepare("SELECT id, owner_user_id, created_at, payload_json FROM sites").all<ResourceRow>(),
      env.DB.prepare("SELECT id, owner_user_id, created_at, payload_json FROM simulations").all<ResourceRow>(),
    ]);

    const users = usersResult.results ?? [];
    const sites = sitesResult.results ?? [];
    const simulations = simulationsResult.results ?? [];
    const userById = new Map(users.map((user) => [user.id, user]));
    const contributorCounts = new Map<string, { userId: string; username: string; avatarUrl: string; contributions: number }>();

    const addContribution = (userId: string) => {
      const user = userById.get(userId);
      if (!user) return;
      const current = contributorCounts.get(userId) ?? {
        userId,
        username: user.username?.trim() || "Unknown user",
        avatarUrl: user.avatar_url ?? "",
        contributions: 0,
      };
      current.contributions += 1;
      contributorCounts.set(userId, current);
    };

    const geoBins = new Map<string, { latBand: number; lonBand: number; count: number }>();
    sites.forEach((site) => {
      addContribution(site.owner_user_id);
      const payload = parseJsonObject<SitePayload>(site.payload_json);
      const lat = payload?.position?.lat;
      const lon = payload?.position?.lon;
      if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return;
      const latBand = Math.floor(lat);
      const lonBand = Math.floor(lon);
      const key = `${latBand}:${lonBand}`;
      const current = geoBins.get(key) ?? { latBand, lonBand, count: 0 };
      current.count += 1;
      geoBins.set(key, current);
    });

    let totalLinks = 0;
    const nonEmptySiteCounts: number[] = [];
    const nonEmptyLinkCounts: number[] = [];
    const sizeBuckets = { "1-2": 0, "3-5": 0, "6-10": 0, "11+": 0 };

    simulations.forEach((simulation) => {
      addContribution(simulation.owner_user_id);
      const payload = parseJsonObject<SimulationPayload>(simulation.payload_json);
      const siteCount = Array.isArray(payload?.snapshot?.sites) ? payload.snapshot.sites.length : 0;
      const linkCount = Array.isArray(payload?.snapshot?.links) ? payload.snapshot.links.length : 0;
      totalLinks += linkCount;
      if (siteCount <= 0) return;
      nonEmptySiteCounts.push(siteCount);
      nonEmptyLinkCounts.push(linkCount);
      sizeBuckets[bucketSimulationSize(siteCount)] += 1;
    });

    const newestMembers = [...users]
      .sort((a, b) => (parseDate(b.created_at)?.getTime() ?? 0) - (parseDate(a.created_at)?.getTime() ?? 0))
      .slice(0, 5)
      .map((user) => ({
        userId: user.id,
        username: user.username?.trim() || "Unknown user",
        avatarUrl: user.avatar_url ?? "",
        createdAt: user.created_at,
      }));

    const body = {
      generatedAt: new Date().toISOString(),
      totals: {
        users: users.length,
        sites: sites.length,
        simulations: simulations.length,
        nonEmptySimulations: nonEmptySiteCounts.length,
        links: totalLinks,
      },
      growth: {
        monthly: buildGrowth(users, sites, simulations, monthLabel),
        weekly: buildGrowth(users, sites, simulations, weekLabel).slice(-52),
      },
      geography: {
        binSizeDegrees: 1,
        bins: Array.from(geoBins.values()).sort((a, b) => b.count - a.count || a.latBand - b.latBand || a.lonBand - b.lonBand),
      },
      complexity: {
        averageSitesPerSimulation: round1(average(nonEmptySiteCounts)),
        medianSitesPerSimulation: round1(median(nonEmptySiteCounts)),
        averageLinksPerSimulation: round1(average(nonEmptyLinkCounts)),
        medianLinksPerSimulation: round1(median(nonEmptyLinkCounts)),
        sizeBuckets,
      },
      highlights: {
        topContributors: Array.from(contributorCounts.values())
          .sort((a, b) => b.contributions - a.contributions || a.username.localeCompare(b.username))
          .slice(0, 5),
        newestMembers,
      },
    };

    return withCors(
      request,
      json(body, {
        headers: {
          "cache-control": CACHE_CONTROL,
        },
      }),
    );
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
