// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import OnboardingTutorialModal from "./OnboardingTutorialModal";

describe("OnboardingTutorialModal", () => {
  it("renders the current Getting Started workflow accessibly", () => {
    render(
      <OnboardingTutorialModal
        onClose={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenSiteLibrary={vi.fn()}
        open
      />,
    );

    expect(screen.getByRole("dialog", { name: "Onboarding Tutorial" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Getting Started", level: 2 })).toBeVisible();
    expect(screen.getByText(/LinkSim uses ITM for terrain-aware propagation/)).toBeVisible();
    expect(screen.getByText(/Cmd\+Click|Ctrl\+Click/)).toBeVisible();
    expect(screen.getByText("Weakest Site")).toBeVisible();
    expect(screen.getByText("Mesh Extension")).toBeVisible();
  });

  it("opens the existing Simulation and Site Library actions", async () => {
    const user = userEvent.setup();
    const onOpenLibrary = vi.fn();
    const onOpenSiteLibrary = vi.fn();
    render(
      <OnboardingTutorialModal
        onClose={vi.fn()}
        onOpenLibrary={onOpenLibrary}
        onOpenSiteLibrary={onOpenSiteLibrary}
        open
      />,
    );

    await user.click(screen.getByRole("link", { name: "Simulation Library" }));
    await user.click(screen.getByRole("link", { name: "Site Library" }));

    expect(onOpenLibrary).toHaveBeenCalledOnce();
    expect(onOpenSiteLibrary).toHaveBeenCalledOnce();
  });
});
