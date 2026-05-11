export type StatsGrowthBucket = {
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

export type StatsPayload = {
  generatedAt: string;
  totals: {
    users: number;
    sites: number;
    simulations: number;
    nonEmptySimulations: number;
    links: number;
  };
  growth: {
    monthly: StatsGrowthBucket[];
    weekly: StatsGrowthBucket[];
  };
  geography: {
    binSizeDegrees: number;
    bins: Array<{
      latBand: number;
      lonBand: number;
      count: number;
    }>;
  };
  siteDensitySummary: Array<{
    label: string;
    count: number;
  }>;
  complexity: {
    averageSitesPerSimulation: number;
    medianSitesPerSimulation: number;
    averageLinksPerSimulation: number;
    medianLinksPerSimulation: number;
    sizeBuckets: Record<"1-2" | "3-5" | "6-10" | "11+", number>;
  };
  latestSimulations: Array<{
    id: string;
    name: string;
    href: string;
    createdAt: string | null;
    owner: {
      userId: string;
      username: string;
      avatarUrl: string;
    };
    siteCount: number;
    linkCount: number;
  }>;
  linkDistanceDistribution: Array<{
    label: string;
    minKm: number;
    maxKm: number | null;
    count: number;
  }>;
  highlights: {
    topContributors: Array<{
      userId: string;
      username: string;
      avatarUrl: string;
      contributions: number;
    }>;
    newestMembers: Array<{
      userId: string;
      username: string;
      avatarUrl: string;
      createdAt: string;
    }>;
  };
};

export const fetchStats = async (): Promise<StatsPayload> => {
  const response = await fetch("/api/stats", { method: "GET" });
  if (!response.ok) {
    throw new Error(`Stats unavailable (${response.status})`);
  }
  return (await response.json()) as StatsPayload;
};
