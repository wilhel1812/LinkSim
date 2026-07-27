import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import { listStatsPathLeaderboardEntries } from "../_lib/pathLeaderboard";
import type { DbVisibility, Env } from "../_lib/types";

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
  name?: string | null;
  visibility: DbVisibility;
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

type GrowthRangeKey = "today" | "last7Days" | "last30Days" | "lastYear" | "allTime";

type SitePayload = {
  position?: {
    lat?: unknown;
    lon?: unknown;
  };
};

type SimulationPayload = {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  snapshot?: {
    sites?: unknown;
    links?: unknown;
  };
};

type SnapshotSite = {
  id?: unknown;
  name?: unknown;
  position?: {
    lat?: unknown;
    lon?: unknown;
  };
};

type SnapshotLink = {
  id?: unknown;
  name?: unknown;
  fromSiteId?: unknown;
  toSiteId?: unknown;
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

const dayLabel = (date: Date): string => date.toISOString().slice(0, 10);

const hourLabel = (date: Date): string => `${String(date.getUTCHours()).padStart(2, "0")}:00`;

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

type GrowthEvent = {
  date: Date;
  key: GrowthCountKey;
  amount: number;
};

const collectGrowthEvents = (users: UserRow[], sites: ResourceRow[], simulations: ResourceRow[]): GrowthEvent[] => {
  const events: GrowthEvent[] = [];
  users.forEach((row) => {
    const date = parseDate(row.created_at);
    if (date) events.push({ date, key: "users", amount: 1 });
  });
  sites.forEach((row) => {
    const date = parseDate(row.created_at);
    if (date) events.push({ date, key: "sites", amount: 1 });
  });
  simulations.forEach((row) => {
    const date = parseDate(row.created_at);
    if (!date) return;
    events.push({ date, key: "simulations", amount: 1 });
    events.push({ date, key: "links", amount: simulationLinkCount(row) });
  });
  return events;
};

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const addUtcDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const addUtcMonths = (date: Date, months: number): Date => {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
};

const buildFixedRangeGrowth = (
  events: GrowthEvent[],
  labels: string[],
  eventLabel: (date: Date) => string | null,
): GrowthBucket[] => {
  const buckets = new Map(labels.map((label) => [label, emptyGrowthCounts()] as const));
  events.forEach((event) => {
    const label = eventLabel(event.date);
    if (!label || !buckets.has(label)) return;
    increment(buckets, label, event.key, event.amount);
  });

  let cumulativeUsers = 0;
  let cumulativeSites = 0;
  let cumulativeSimulations = 0;
  let cumulativeLinks = 0;
  return labels.map((label) => {
    const counts = buckets.get(label) ?? emptyGrowthCounts();
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

const buildGrowthRanges = (
  users: UserRow[],
  sites: ResourceRow[],
  simulations: ResourceRow[],
  now = new Date(),
): Record<GrowthRangeKey, GrowthBucket[]> => {
  const events = collectGrowthEvents(users, sites, simulations);
  const todayStart = startOfUtcDay(now);
  const todayLabels = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
  const last7Start = addUtcDays(todayStart, -6);
  const last30Start = addUtcDays(todayStart, -29);
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const last7Labels = Array.from({ length: 7 }, (_, index) => dayLabel(addUtcDays(last7Start, index)));
  const last30Labels = Array.from({ length: 30 }, (_, index) => dayLabel(addUtcDays(last30Start, index)));
  const lastYearLabels = Array.from({ length: 12 }, (_, index) => monthLabel(addUtcMonths(yearStart, index)));

  return {
    today: buildFixedRangeGrowth(
      events,
      todayLabels,
      (date) => date >= todayStart && date < addUtcDays(todayStart, 1) ? hourLabel(date) : null,
    ),
    last7Days: buildFixedRangeGrowth(
      events,
      last7Labels,
      (date) => date >= last7Start && date < addUtcDays(todayStart, 1) ? dayLabel(date) : null,
    ),
    last30Days: buildFixedRangeGrowth(
      events,
      last30Labels,
      (date) => date >= last30Start && date < addUtcDays(todayStart, 1) ? dayLabel(date) : null,
    ),
    lastYear: buildFixedRangeGrowth(
      events,
      lastYearLabels,
      (date) => date >= yearStart && date < addUtcMonths(yearStart, 12) ? monthLabel(date) : null,
    ),
    allTime: buildGrowth(users, sites, simulations, monthLabel),
  };
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

const slugifySegment = (value: string): string =>
  value
    .trim()
    .normalize("NFKC")
    .replace(/[\uFE0E\uFE0F]/g, "")
    .replace(/[+<>~/]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const hrefForSimulation = (owner: UserRow | undefined, simulation: ResourceRow, payload: SimulationPayload | null): string => {
  const username = slugifySegment(owner?.username?.trim() || "");
  const name = typeof payload?.slug === "string" && payload.slug.trim()
    ? payload.slug
    : typeof payload?.name === "string" && payload.name.trim()
      ? payload.name
      : simulation.name ?? "";
  const simulationSlug = slugifySegment(name);
  if (username && simulationSlug) return `/${username}/${simulationSlug}`;
  return `/?sim=${encodeURIComponent(simulation.id)}`;
};

const formatGeoLabel = (latBand: number, lonBand: number): string => {
  const latSuffix = latBand >= 0 ? "N" : "S";
  const lonSuffix = lonBand >= 0 ? "E" : "W";
  return `${Math.abs(latBand)}°${latSuffix}, ${Math.abs(lonBand)}°${lonSuffix}`;
};

const haversineKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLon = toRadians(b.lon - a.lon);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * (2 * Math.asin(Math.sqrt(value)));
};

const DISTANCE_BUCKETS = [
  { label: "0-10 km", minKm: 0, maxKm: 10 },
  { label: "10-25 km", minKm: 10, maxKm: 25 },
  { label: "25-50 km", minKm: 25, maxKm: 50 },
  { label: "50-100 km", minKm: 50, maxKm: 100 },
  { label: "100+ km", minKm: 100, maxKm: null },
];

const bucketForDistance = (distanceKm: number) =>
  DISTANCE_BUCKETS.find((bucket) => distanceKm >= bucket.minKm && (bucket.maxKm === null || distanceKm < bucket.maxKm));

const snapshotSites = (payload: SimulationPayload | null): SnapshotSite[] =>
  Array.isArray(payload?.snapshot?.sites) ? (payload.snapshot.sites as SnapshotSite[]) : [];

const snapshotLinks = (payload: SimulationPayload | null): SnapshotLink[] =>
  Array.isArray(payload?.snapshot?.links) ? (payload.snapshot.links as SnapshotLink[]) : [];

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const [usersResult, sitesResult, simulationsResult, longestPassingPaths] = await Promise.all([
      env.DB.prepare("SELECT id, username, avatar_url, created_at FROM users").all<UserRow>(),
      env.DB.prepare("SELECT id, owner_user_id, created_at, visibility, payload_json FROM sites").all<ResourceRow>(),
      env.DB.prepare("SELECT id, owner_user_id, created_at, name, visibility, payload_json FROM simulations").all<ResourceRow>(),
      listStatsPathLeaderboardEntries(env),
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

    const latestSimulations: Array<{
      visibility: DbVisibility;
      id: string;
      name: string;
      href: string;
      createdAt: string | null;
      owner: { userId: string; username: string; avatarUrl: string };
      siteCount: number;
      linkCount: number;
    }> = [];
    const linkDistanceCounts = DISTANCE_BUCKETS.map((bucket) => ({ ...bucket, count: 0 }));

    simulations.forEach((simulation) => {
      addContribution(simulation.owner_user_id);
      const payload = parseJsonObject<SimulationPayload>(simulation.payload_json);
      const sitesInSimulation = snapshotSites(payload);
      const linksInSimulation = snapshotLinks(payload);
      const siteCount = sitesInSimulation.length;
      const linkCount = linksInSimulation.length;
      totalLinks += linkCount;
      if (siteCount <= 0) return;
      nonEmptySiteCounts.push(siteCount);
      nonEmptyLinkCounts.push(linkCount);
      sizeBuckets[bucketSimulationSize(siteCount)] += 1;

      const owner = userById.get(simulation.owner_user_id);
      latestSimulations.push({
        visibility: simulation.visibility,
        id: simulation.id,
        name: typeof payload?.name === "string" && payload.name.trim() ? payload.name.trim() : simulation.name?.trim() || "Untitled Simulation",
        href: hrefForSimulation(owner, simulation, payload),
        createdAt: simulation.created_at,
        owner: {
          userId: simulation.owner_user_id,
          username: owner?.username?.trim() || "Unknown user",
          avatarUrl: owner?.avatar_url ?? "",
        },
        siteCount,
        linkCount,
      });

      const sitesById = new Map(
        sitesInSimulation
          .filter((site) => typeof site.id === "string")
          .map((site) => [site.id as string, site]),
      );
      linksInSimulation.forEach((link) => {
        if (typeof link.fromSiteId !== "string" || typeof link.toSiteId !== "string") return;
        const from = sitesById.get(link.fromSiteId);
        const to = sitesById.get(link.toSiteId);
        const fromLat = from?.position?.lat;
        const fromLon = from?.position?.lon;
        const toLat = to?.position?.lat;
        const toLon = to?.position?.lon;
        if (!isFiniteNumber(fromLat) || !isFiniteNumber(fromLon) || !isFiniteNumber(toLat) || !isFiniteNumber(toLon)) return;
        const distanceKm = haversineKm({ lat: fromLat, lon: fromLon }, { lat: toLat, lon: toLon });
        const bucket = bucketForDistance(distanceKm);
        if (bucket) linkDistanceCounts.find((entry) => entry.label === bucket.label)!.count += 1;
      });
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

    const growthRanges = buildGrowthRanges(users, sites, simulations);
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
        ...growthRanges,
        monthly: growthRanges.allTime,
        weekly: buildGrowth(users, sites, simulations, weekLabel).slice(-52),
      },
      geography: {
        binSizeDegrees: 1,
        bins: Array.from(geoBins.values()).sort((a, b) => b.count - a.count || a.latBand - b.latBand || a.lonBand - b.lonBand),
      },
      siteDensitySummary: Array.from(geoBins.values())
        .sort((a, b) => b.count - a.count || a.latBand - b.latBand || a.lonBand - b.lonBand)
        .slice(0, 5)
        .map((bin) => ({ label: formatGeoLabel(bin.latBand, bin.lonBand), count: bin.count })),
      complexity: {
        averageSitesPerSimulation: round1(average(nonEmptySiteCounts)),
        medianSitesPerSimulation: round1(median(nonEmptySiteCounts)),
        averageLinksPerSimulation: round1(average(nonEmptyLinkCounts)),
        medianLinksPerSimulation: round1(median(nonEmptyLinkCounts)),
        sizeBuckets,
      },
      latestSimulations: latestSimulations
        .sort((a, b) => (parseDate(b.createdAt)?.getTime() ?? 0) - (parseDate(a.createdAt)?.getTime() ?? 0))
        .slice(0, 5)
        .map((simulation) =>
          simulation.visibility === "private"
            ? {
                visibility: "private" as const,
                siteCount: simulation.siteCount,
                linkCount: simulation.linkCount,
              }
            : {
                visibility: "shared" as const,
                id: simulation.id,
                name: simulation.name,
                href: simulation.href,
                createdAt: simulation.createdAt,
                owner: simulation.owner,
                siteCount: simulation.siteCount,
                linkCount: simulation.linkCount,
              },
        ),
      longestPassingPaths,
      linkDistanceDistribution: linkDistanceCounts,
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
