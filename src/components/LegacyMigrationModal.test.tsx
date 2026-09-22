// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LegacyMigrationModal } from "./LegacyMigrationModal";

describe("LegacyMigrationModal", () => {
  it("keeps the full migration progress visible while GitHub starts automatically", async () => {
    const onGithub = vi.fn();
    render(
      <LegacyMigrationModal
        autoStartGithub
        error={null}
        githubBusy
        onAutoGithub={onGithub}
        onGithub={onGithub}
        onRestart={vi.fn()}
        stage="github"
      />,
    );

    expect(screen.getByRole("dialog", { name: "Move your LinkSim account" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Migration progress" })).toHaveTextContent(
      "1. Cloudflare accountConfirmed2. GitHubIn progress3. LinkSim accountWaiting",
    );
    await waitFor(() => expect(onGithub).toHaveBeenCalledWith(screen.getByLabelText("Anti-bot check")));
    expect(onGithub).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
  });

  it("keeps an actionable GitHub retry in the modal after a recoverable failure", async () => {
    const onGithub = vi.fn();
    render(
      <LegacyMigrationModal
        autoStartGithub={false}
        error="GitHub sign-in failed. Try again."
        githubBusy={false}
        onAutoGithub={vi.fn()}
        onGithub={onGithub}
        onRestart={vi.fn()}
        stage="github"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("GitHub sign-in failed. Try again.");
    await userEvent.click(screen.getByRole("button", { name: "Try GitHub again" }));
    expect(onGithub).toHaveBeenCalledWith(screen.getByLabelText("Anti-bot check"));
  });

  it("offers a full restart when LinkSim cannot finish the mapping", async () => {
    const onRestart = vi.fn();
    render(
      <LegacyMigrationModal
        autoStartGithub={false}
        error="The migration attempt expired. Start again."
        githubBusy={false}
        onAutoGithub={vi.fn()}
        onGithub={vi.fn()}
        onRestart={onRestart}
        stage="failed"
      />,
    );

    expect(screen.getByRole("list", { name: "Migration progress" })).toHaveTextContent(
      "1. Cloudflare accountConfirmed2. GitHubConfirmed3. LinkSim accountNeeds attention",
    );
    await userEvent.click(screen.getByRole("button", { name: "Start migration again" }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("allows GitHub continuation when a restored page has no active request", async () => {
    const onGithub = vi.fn();
    render(
      <LegacyMigrationModal
        autoStartGithub={false}
        error={null}
        githubBusy={false}
        onAutoGithub={vi.fn()}
        onGithub={onGithub}
        onRestart={vi.fn()}
        stage="github"
      />,
    );

    const continueButton = screen.getByRole("button", { name: "Continue with GitHub" });
    expect(continueButton).toBeEnabled();
    await userEvent.click(continueButton);
    expect(onGithub).toHaveBeenCalledWith(screen.getByLabelText("Anti-bot check"));
  });

  it("allows Cloudflare restart when a restored page abandoned that sign-in", async () => {
    const onRestart = vi.fn();
    render(
      <LegacyMigrationModal
        autoStartGithub={false}
        error={null}
        githubBusy={false}
        onAutoGithub={vi.fn()}
        onGithub={vi.fn()}
        onRestart={onRestart}
        stage="opening-cloudflare"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open Cloudflare sign-in again" }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
