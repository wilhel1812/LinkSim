// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../hooks/useThemeVariant", () => ({
  useThemeVariant: () => ({ theme: "light", variant: { cssVars: {} }, activeHolidayTheme: null }),
}));

vi.mock("./StatsDensityMap", () => ({
  StatsDensityMap: ({ bins }: { bins: Array<{ count: number }> }) => (
    bins.length
      ? <div data-testid="stats-density-map">Map bins: {bins.length}</div>
      : <div>Site density will appear after Sites with coordinates are created.</div>
  ),
}));

import { StatsPage } from "./StatsPage";

const statsPayload = {
  generatedAt: "2026-05-11T00:00:00.000Z",
  totals: {
    users: 12,
    sites: 34,
    simulations: 8,
    nonEmptySimulations: 6,
    links: 21,
  },
  growth: {
    monthly: [
      { label: "2026-01", users: 2, sites: 4, simulations: 1, links: 5, cumulativeUsers: 2, cumulativeSites: 4, cumulativeSimulations: 1, cumulativeLinks: 5 },
      { label: "2026-02", users: 3, sites: 6, simulations: 2, links: 7, cumulativeUsers: 5, cumulativeSites: 10, cumulativeSimulations: 3, cumulativeLinks: 12 },
    ],
    weekly: [
      { label: "2026-05-04", users: 1, sites: 2, simulations: 1, links: 3, cumulativeUsers: 1, cumulativeSites: 2, cumulativeSimulations: 1, cumulativeLinks: 3 },
    ],
  },
  geography: {
    binSizeDegrees: 1,
    bins: [{ latBand: 60, lonBand: 10, count: 5 }],
  },
  complexity: {
    averageSitesPerSimulation: 3,
    medianSitesPerSimulation: 2.5,
    averageLinksPerSimulation: 1.5,
    medianLinksPerSimulation: 1,
    sizeBuckets: { "1-2": 2, "3-5": 3, "6-10": 1, "11+": 0 },
  },
  latestSimulations: [
    {
      id: "sim-2",
      name: "Shared Ridge",
      href: "/Grace/Shared-Ridge",
      createdAt: "2026-05-10T00:00:00.000Z",
      owner: { userId: "u2", username: "Grace", avatarUrl: "" },
      siteCount: 3,
      linkCount: 2,
    },
  ],
  linkDistanceDistribution: [
    { label: "0-10 km", minKm: 0, maxKm: 10, count: 1 },
    { label: "10-25 km", minKm: 10, maxKm: 25, count: 2 },
  ],
  siteDensitySummary: [{ label: "60°N, 10°E", count: 5 }],
  highlights: {
    topContributors: [{ userId: "u1", username: "Ada", avatarUrl: "", contributions: 4 }],
    newestMembers: [{ userId: "u2", username: "Grace", avatarUrl: "", createdAt: "2026-05-01T00:00:00.000Z" }],
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => statsPayload,
    })),
  );
});

describe("StatsPage", () => {
  it("renders public infographic sections from /api/stats", async () => {
    render(<StatsPage />);

    await screen.findByText("Stats");
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(screen.getByText("34")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("21")).toBeInTheDocument();
    expect(screen.getByText("Growth over time")).toBeInTheDocument();
    expect(screen.getByText("Site Geography")).toBeInTheDocument();
    expect(screen.getByText("Contributor Highlights")).toBeInTheDocument();
    expect(screen.getByText("Latest Simulations")).toBeInTheDocument();
    expect(screen.getByText("Simulation Complexity")).toBeInTheDocument();
    expect(screen.getByText("Simulations by Size")).toBeInTheDocument();
    expect(screen.getByText("Site Density")).toBeInTheDocument();
    expect(screen.getByText("Link Distance Distribution")).toBeInTheDocument();
    expect(screen.getByTestId("stats-density-map")).toHaveTextContent("Map bins: 1");
    expect(screen.getByRole("link", { name: /Shared Ridge/i })).toHaveAttribute("href", "/Grace/Shared-Ridge");
    expect(screen.queryByText("Moderator Snapshot")).not.toBeInTheDocument();
    expect(screen.queryByText(/Longest Passing Path/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/draft/i)).not.toBeInTheDocument();
    expect(screen.queryByText("ready")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/stats", { method: "GET" });
  });

  it("switches the growth chart between all-time and recent buckets", async () => {
    render(<StatsPage />);
    await screen.findByRole("button", { name: "All time" });

    expect(screen.getByText(/2026-01 to 2026-02/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Last 30 days"));

    await waitFor(() => {
      expect(screen.getByText(/2026-05-04 to 2026-05-04/)).toBeInTheDocument();
    });
  });

  it("renders polished empty states", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ...statsPayload,
          growth: { monthly: [], weekly: [] },
          geography: { binSizeDegrees: 1, bins: [] },
          latestSimulations: [],
          linkDistanceDistribution: [],
          siteDensitySummary: [],
        }),
      })),
    );

    render(<StatsPage />);

    expect(await screen.findByText("Growth appears after dated community activity is available.")).toBeInTheDocument();
    expect(screen.getByText("Site density will appear after Sites with coordinates are created.")).toBeInTheDocument();
    expect(screen.getByText("Latest non-empty Simulations will appear here.")).toBeInTheDocument();
  });
});
