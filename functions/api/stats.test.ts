import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onRequestGet } from "./stats";

type MockTable = {
  users: Array<{ id: string; username: string | null; avatar_url: string | null; created_at: string }>;
  sites: Array<{ id: string; owner_user_id: string; created_at: string | null; payload_json: string }>;
  simulations: Array<{ id: string; owner_user_id: string; created_at: string | null; name?: string; payload_json: string }>;
};

const tables: MockTable = {
  users: [],
  sites: [],
  simulations: [],
};

const env = {
  DB: {
    prepare: (sql: string) => ({
      all: async () => {
        if (sql.includes("FROM users")) return { results: tables.users };
        if (sql.includes("FROM sites")) return { results: tables.sites };
        if (sql.includes("FROM simulations")) return { results: tables.simulations };
        return { results: [] };
      },
    }),
  },
} as unknown as { DB: D1Database };

const mkCtx = (request = new Request("https://example.test/api/stats")) =>
  ({ request, env } as unknown as Parameters<typeof onRequestGet>[0]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-10T12:30:00.000Z"));
  tables.users = [
    { id: "u1", username: "Ada", avatar_url: "https://example.test/ada.png", created_at: "2026-01-03T00:00:00.000Z" },
    { id: "u2", username: "Grace", avatar_url: null, created_at: "2026-02-10T00:00:00.000Z" },
  ];
  tables.sites = [
    {
      id: "site-1",
      owner_user_id: "u1",
      created_at: "2026-01-05T00:00:00.000Z",
      payload_json: JSON.stringify({ id: "site-1", name: "Private peak", position: { lat: 60.123456, lon: 10.123456 } }),
    },
    {
      id: "site-2",
      owner_user_id: "u2",
      created_at: "2026-02-05T00:00:00.000Z",
      payload_json: JSON.stringify({ id: "site-2", name: "Valley", position: { lat: 60.987654, lon: 10.987654 } }),
    },
    {
      id: "bad-site",
      owner_user_id: "u2",
      created_at: "2026-02-06T00:00:00.000Z",
      payload_json: "{not json",
    },
  ];
  tables.simulations = [
    {
      id: "sim-1",
      owner_user_id: "u1",
      created_at: "2026-01-07T00:00:00.000Z",
      payload_json: JSON.stringify({
        id: "sim-1",
        name: "Private sim",
        snapshot: {
          sites: [
            { id: "s1", name: "North", position: { lat: 60, lon: 10 } },
            { id: "s2", name: "South", position: { lat: 60.1, lon: 10.1 } },
            { id: "s3", name: "East", position: { lat: 61, lon: 11 } },
          ],
          links: [
            { id: "l1", name: "Short ridge", fromSiteId: "s1", toSiteId: "s2", frequencyMHz: 868 },
            { id: "l2", fromSiteId: "s2", toSiteId: "s3", frequencyMHz: 915 },
            { id: "auto-link", name: " Auto link ", fromSiteId: "s1", toSiteId: "s3", frequencyMHz: 868 },
            { id: "__auto__", name: "Auto-Link", fromSiteId: "s1", toSiteId: "s3", frequencyMHz: 868 },
            { id: "bad-link", fromSiteId: "s1", toSiteId: "missing" },
          ],
        },
      }),
    },
    {
      id: "sim-empty",
      owner_user_id: "u2",
      created_at: "2026-02-07T00:00:00.000Z",
      payload_json: JSON.stringify({ id: "sim-empty", name: "Draft", snapshot: { sites: [], links: [] } }),
    },
    {
      id: "sim-2",
      owner_user_id: "u2",
      created_at: "2026-02-08T00:00:00.000Z",
      payload_json: JSON.stringify({
        id: "sim-2",
        name: "Shared sim",
        slug: "Shared-sim",
        snapshot: {
          sites: [{ id: "s4", name: "Solo", position: { lat: 62, lon: 12 } }],
          links: [{ id: "l3" }, { id: "malformed", fromSiteId: "s4", toSiteId: "missing" }],
        },
      }),
    },
  ];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("api/stats", () => {
  it("returns public aggregate stats without auth", async () => {
    const res = await onRequestGet(mkCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage=900");

    const body = await res.json() as {
      totals: { users: number; sites: number; simulations: number; nonEmptySimulations: number; links: number };
      complexity: { averageSitesPerSimulation: number; averageLinksPerSimulation: number };
    };

    expect(body.totals).toMatchObject({
      users: 2,
      sites: 3,
      simulations: 3,
      nonEmptySimulations: 2,
      links: 7,
    });
    expect(body.complexity.averageSitesPerSimulation).toBe(2);
    expect(body.complexity.averageLinksPerSimulation).toBe(3.5);
  });

  it("returns latest non-empty simulations and link distance buckets without leaking payloads", async () => {
    const res = await onRequestGet(mkCtx());
    const body = await res.json() as {
      latestSimulations: Array<{
        id: string;
        name: string;
        href: string;
        owner: { userId: string; username: string; avatarUrl: string };
        siteCount: number;
        linkCount: number;
      }>;
      linkDistanceDistribution: Array<{ label: string; minKm: number; maxKm: number | null; count: number }>;
      siteDensitySummary: Array<{ label: string; count: number }>;
      longestLinks: Array<{ label: string; href: string; simulationName: string; distanceKm: number; owner: { username: string } }>;
    };
    const raw = JSON.stringify(body);

    expect(body.latestSimulations).toEqual([
      expect.objectContaining({
        id: "sim-2",
        name: "Shared sim",
        href: "/Grace/Shared-sim",
        owner: { userId: "u2", username: "Grace", avatarUrl: "" },
        siteCount: 1,
        linkCount: 2,
      }),
      expect.objectContaining({
        id: "sim-1",
        name: "Private sim",
        href: "/Ada/Private-sim",
        siteCount: 3,
        linkCount: 5,
      }),
    ]);
    expect(body.latestSimulations.some((entry) => entry.id === "sim-empty")).toBe(false);
    expect(body.linkDistanceDistribution.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(4);
    expect(body.longestLinks).toHaveLength(2);
    expect(body.longestLinks[0]).toMatchObject({
      label: "South ~ East",
      href: "/Ada/Private-sim/South~East",
      simulationName: "Private sim",
      owner: { username: "Ada" },
    });
    expect(body.longestLinks.some((entry) => entry.label.toLowerCase().includes("auto"))).toBe(false);
    expect(body.longestLinks[0].distanceKm).toBeGreaterThan(body.longestLinks[1].distanceKm);
    expect(body.siteDensitySummary).toEqual([{ label: "60°N, 10°E", count: 2 }]);
    expect(raw).not.toContain("60.1");
    expect(raw).not.toContain("61");
    expect(raw).not.toContain("payload_json");
  });

  it("returns UTC growth ranges including hourly today buckets", async () => {
    const res = await onRequestGet(mkCtx());
    const body = await res.json() as {
      growth: {
        today: Array<{ label: string; users: number; sites: number; simulations: number; links: number }>;
        last7Days: Array<{ label: string; users: number; sites: number; simulations: number; links: number }>;
        last30Days: Array<{ label: string; users: number; sites: number; simulations: number; links: number }>;
        lastYear: Array<{ label: string; users: number; sites: number; simulations: number; links: number }>;
        allTime: Array<{ label: string; users: number; sites: number; simulations: number; links: number; cumulativeLinks: number }>;
        monthly: Array<{ label: string; users: number; sites: number; simulations: number; links: number; cumulativeLinks: number }>;
        weekly: Array<{ users: number; sites: number; simulations: number; links: number }>;
      };
    };

    expect(body.growth.today).toHaveLength(24);
    expect(body.growth.today[12]).toMatchObject({ label: "12:00", users: 0, sites: 0, simulations: 0, links: 0 });
    expect(body.growth.last7Days).toHaveLength(7);
    expect(body.growth.last30Days).toHaveLength(30);
    expect(body.growth.lastYear).toHaveLength(12);
    expect(body.growth.allTime).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "2026-01", users: 1, sites: 1, simulations: 1, links: 5, cumulativeLinks: 5 }),
        expect.objectContaining({ label: "2026-02", users: 1, sites: 2, simulations: 2, links: 2, cumulativeLinks: 7 }),
      ]),
    );
    expect(body.growth.monthly).toEqual(body.growth.allTime);
    expect(body.growth.weekly.length).toBeGreaterThan(0);
  });

  it("returns binned geography without raw coordinates or payloads", async () => {
    const res = await onRequestGet(mkCtx());
    const body = await res.json() as {
      geography: { bins: Array<{ latBand: number; lonBand: number; count: number }> };
    };
    const raw = JSON.stringify(body);

    expect(body.geography.bins).toEqual([{ latBand: 60, lonBand: 10, count: 2 }]);
    expect(raw).not.toContain("60.123456");
    expect(raw).not.toContain("Private peak");
    expect(raw).not.toContain("payload_json");
  });
});
