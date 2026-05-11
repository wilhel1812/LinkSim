// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../hooks/useThemeVariant", () => ({
  useThemeVariant: () => ({ theme: "light", variant: { cssVars: {} }, activeHolidayTheme: null }),
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
  highlights: {
    topContributors: [],
    newestMembers: [],
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
    expect(screen.getByText("Growth")).toBeInTheDocument();
    expect(screen.getByText("Site Geography")).toBeInTheDocument();
    expect(screen.getByText("Contributor Highlights")).toBeInTheDocument();
    expect(screen.getByText("Simulation Complexity")).toBeInTheDocument();
    expect(screen.getByText("Radio And Network Flavor")).toBeInTheDocument();
    expect(screen.getByText("Geography Details")).toBeInTheDocument();
    expect(screen.queryByText("Moderator Snapshot")).not.toBeInTheDocument();
    expect(screen.queryByText(/draft/i)).not.toBeInTheDocument();
    expect(screen.queryByText("ready")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/stats", { method: "GET" });
  });

  it("switches the growth chart between all-time and recent buckets", async () => {
    render(<StatsPage />);
    await screen.findByText("All time");

    expect(screen.getAllByText(/2026-01:/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Recent"));

    await waitFor(() => {
      expect(screen.getAllByText(/2026-05-04:/).length).toBeGreaterThan(0);
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
        }),
      })),
    );

    render(<StatsPage />);

    expect(await screen.findAllByText("No growth data yet.")).toHaveLength(4);
    expect(screen.getByText("Site density will appear after Sites with coordinates are created.")).toBeInTheDocument();
  });
});
