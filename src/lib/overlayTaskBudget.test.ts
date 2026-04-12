import { describe, expect, it } from "vitest";
import { overlayTaskBudgetForMode } from "./overlayTaskBudget";

describe("overlayTaskBudgetForMode", () => {
  it("allocates higher frame budget for pass/fail and relay than lighter modes", () => {
    const heatmap = overlayTaskBudgetForMode("heatmap");
    const contours = overlayTaskBudgetForMode("contours");
    const terrain = overlayTaskBudgetForMode("terrain");
    const passFail = overlayTaskBudgetForMode("passfail");
    const relay = overlayTaskBudgetForMode("relay");

    expect(passFail.frameBudgetMs).toBeGreaterThan(heatmap.frameBudgetMs);
    expect(passFail.frameBudgetMs).toBeGreaterThan(contours.frameBudgetMs);
    expect(passFail.frameBudgetMs).toBeGreaterThan(terrain.frameBudgetMs);
    expect(relay.frameBudgetMs).toBeGreaterThan(heatmap.frameBudgetMs);
    expect(relay.frameBudgetMs).toBeGreaterThan(terrain.frameBudgetMs);
  });

  it("always sets a long-task threshold not lower than frame budget", () => {
    const modes = ["heatmap", "contours", "passfail", "relay", "terrain"] as const;
    for (const mode of modes) {
      const budget = overlayTaskBudgetForMode(mode);
      expect(budget.longTaskMs).toBeGreaterThanOrEqual(budget.frameBudgetMs);
    }
  });
});
