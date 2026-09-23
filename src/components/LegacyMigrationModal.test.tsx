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
        existingProfileUsername={null}
        githubBusy
        onAutoGithub={onGithub}
        onContinueExistingProfile={vi.fn()}
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
        existingProfileUsername={null}
        githubBusy={false}
        onAutoGithub={vi.fn()}
        onContinueExistingProfile={vi.fn()}
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
        existingProfileUsername={null}
        githubBusy={false}
        onAutoGithub={vi.fn()}
        onContinueExistingProfile={vi.fn()}
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

  it("requires an explicit choice before continuing with an existing GitHub profile", async () => {
    const onContinueExistingProfile = vi.fn();
    const onRestart = vi.fn();
    render(
      <LegacyMigrationModal
        autoStartGithub={false}
        error="GitHub signed you in as Owner. That profile is connected to a different LinkSim account, so your Cloudflare account was not moved. Continue only if Owner is the account you want to use."
        existingProfileUsername="Owner"
        githubBusy={false}
        onAutoGithub={vi.fn()}
        onContinueExistingProfile={onContinueExistingProfile}
        onGithub={vi.fn()}
        onRestart={onRestart}
        stage="failed"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("your Cloudflare account was not moved");
    await userEvent.click(screen.getByRole("button", { name: "Continue as Owner" }));
    expect(onContinueExistingProfile).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
  });

  it("offers continuation when the existing profile still needs a username", () => {
    render(
      <LegacyMigrationModal
        autoStartGithub={false}
        error="GitHub signed you in to a LinkSim profile that still needs a username."
        existingProfileUsername=""
        githubBusy={false}
        onAutoGithub={vi.fn()}
        onContinueExistingProfile={vi.fn()}
        onGithub={vi.fn()}
        onRestart={vi.fn()}
        stage="failed"
      />,
    );

    expect(screen.getByRole("button", { name: "Continue with this account" })).toBeInTheDocument();
  });

  it("allows GitHub continuation when a restored page has no active request", async () => {
    const onGithub = vi.fn();
    render(
      <LegacyMigrationModal
        autoStartGithub={false}
        error={null}
        existingProfileUsername={null}
        githubBusy={false}
        onAutoGithub={vi.fn()}
        onContinueExistingProfile={vi.fn()}
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
        existingProfileUsername={null}
        githubBusy={false}
        onAutoGithub={vi.fn()}
        onContinueExistingProfile={vi.fn()}
        onGithub={vi.fn()}
        onRestart={onRestart}
        stage="opening-cloudflare"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open Cloudflare sign-in again" }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
