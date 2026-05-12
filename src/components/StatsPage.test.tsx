// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../hooks/useThemeVariant", () => ({
  useThemeVariant: () => ({ theme: "light", colorTheme: "blue", variant: { cssVars: {} }, activeHolidayTheme: null }),
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
    today: Array.from({ length: 24 }, (_, hour) => ({
      label: `${String(hour).padStart(2, "0")}:00`,
      users: hour === 10 ? 1 : 0,
      sites: 0,
      simulations: 0,
      links: 0,
      cumulativeUsers: hour >= 10 ? 1 : 0,
      cumulativeSites: 0,
      cumulativeSimulations: 0,
      cumulativeLinks: 0,
    })),
    last7Days: [
      { label: "2026-05-04", users: 1, sites: 2, simulations: 1, links: 3, cumulativeUsers: 1, cumulativeSites: 2, cumulativeSimulations: 1, cumulativeLinks: 3 },
    ],
    last30Days: [
      { label: "2026-05-04", users: 1, sites: 2, simulations: 1, links: 3, cumulativeUsers: 1, cumulativeSites: 2, cumulativeSimulations: 1, cumulativeLinks: 3 },
    ],
    lastYear: [
      { label: "2026-05", users: 3, sites: 6, simulations: 2, links: 7, cumulativeUsers: 3, cumulativeSites: 6, cumulativeSimulations: 2, cumulativeLinks: 7 },
    ],
    allTime: [
      { label: "2026-01", users: 2, sites: 4, simulations: 1, links: 5, cumulativeUsers: 2, cumulativeSites: 4, cumulativeSimulations: 1, cumulativeLinks: 5 },
      { label: "2026-02", users: 3, sites: 6, simulations: 2, links: 7, cumulativeUsers: 5, cumulativeSites: 10, cumulativeSimulations: 3, cumulativeLinks: 12 },
    ],
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
  longestLinks: [
    {
      id: "sim-2:l1",
      label: "Ridge to Valley",
      href: "/Grace/Shared-Ridge/Ridge~Valley",
      simulationHref: "/Grace/Shared-Ridge",
      simulationName: "Shared Ridge",
      distanceKm: 42.4,
      owner: { userId: "u2", username: "Grace", avatarUrl: "" },
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
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-05-12T12:00:00.000Z").getTime());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/users/u1")) {
        return {
          ok: true,
          json: async () => ({
            user: {
              id: "u1",
              username: "Ada",
              bio: "Radio planner",
              avatarUrl: "",
              isAdmin: false,
              isApproved: true,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: null,
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => statsPayload,
      };
    }),
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
    expect(screen.getByText("Link Distance Distribution")).toBeInTheDocument();
    expect(screen.getByText("Top 5 Longest Links")).toBeInTheDocument();
    expect(screen.getByTestId("stats-density-map")).toHaveTextContent("Map bins: 1");
    expect(screen.getByRole("link", { name: /Back to app/i })).toHaveAttribute("href", "/");
    expect(screen.getAllByRole("link", { name: /Shared Ridge/i })[0]).toHaveAttribute("href", "/Grace/Shared-Ridge");
    expect(screen.getByRole("link", { name: /Ridge to Valley/i })).toHaveAttribute("href", "/Grace/Shared-Ridge/Ridge~Valley");
    expect(screen.getByText("Sites + Simulations")).toBeInTheDocument();
    expect(screen.getByText("11 days ago")).toBeInTheDocument();
    expect(screen.queryByText("Median Sites")).not.toBeInTheDocument();
    expect(screen.queryByText("Median Links")).not.toBeInTheDocument();
    expect(screen.queryByText("Site Density")).not.toBeInTheDocument();
    expect(screen.queryByText("Moderator Snapshot")).not.toBeInTheDocument();
    expect(screen.queryByText(/Longest Passing Path/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/draft/i)).not.toBeInTheDocument();
    expect(screen.queryByText("ready")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/stats", { method: "GET" });
  });

  it("switches the growth chart across ranges with active state", async () => {
    render(<StatsPage />);
    await screen.findByRole("button", { name: "Last 30 days" });

    expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Last 30 days · UTC/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Today"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(/Today · UTC/)).toBeInTheDocument();
    });
  });

  it("opens the profile modal from contributor rows", async () => {
    render(<StatsPage />);
    await screen.findByText("Contributor Highlights");

    fireEvent.click(screen.getByRole("button", { name: /Ada/i }));

    expect(await screen.findByRole("heading", { name: "User Profile" })).toBeInTheDocument();
    expect(screen.getByText(/Radio planner/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/users/u1", expect.objectContaining({ method: "GET" }));
  });

  it("renders polished empty states", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ...statsPayload,
          growth: { ...statsPayload.growth, today: [], last7Days: [], last30Days: [], lastYear: [], allTime: [], monthly: [], weekly: [] },
          geography: { binSizeDegrees: 1, bins: [] },
          latestSimulations: [],
          linkDistanceDistribution: [],
          siteDensitySummary: [],
          longestLinks: [],
        }),
      })),
    );

    render(<StatsPage />);

    expect(await screen.findByText("Growth appears after dated community activity is available.")).toBeInTheDocument();
    expect(screen.getByText("Site density will appear after Sites with coordinates are created.")).toBeInTheDocument();
    expect(screen.getByText("Latest non-empty Simulations will appear here.")).toBeInTheDocument();
  });
});
