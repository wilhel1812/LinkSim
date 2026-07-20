export type OverlayTaskMode = "heatmap" | "contours" | "weakest" | "passfail" | "relay" | "mesh-extension" | "terrain";

export type OverlayTaskBudget = {
  frameBudgetMs: number;
  longTaskMs: number;
};

const BUDGET_BY_MODE: Record<OverlayTaskMode, OverlayTaskBudget> = {
  heatmap: { frameBudgetMs: 9, longTaskMs: 30 },
  contours: { frameBudgetMs: 9, longTaskMs: 30 },
  weakest: { frameBudgetMs: 9, longTaskMs: 30 },
  passfail: { frameBudgetMs: 14, longTaskMs: 42 },
  relay: { frameBudgetMs: 14, longTaskMs: 42 },
  "mesh-extension": { frameBudgetMs: 16, longTaskMs: 48 },
  terrain: { frameBudgetMs: 8, longTaskMs: 28 },
};

export const overlayTaskBudgetForMode = (mode: OverlayTaskMode): OverlayTaskBudget => BUDGET_BY_MODE[mode];
