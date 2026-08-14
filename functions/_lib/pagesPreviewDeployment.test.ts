import { describe, expect, it, vi } from "vitest";
import {
  hasMatchingPagesDeployment,
  parsePagesDeploymentUrl,
  resolveDeploymentCommit,
  validatePreviewBranch,
  verifyMatchingPagesDeployment,
} from "../../scripts/pages-preview.mjs";

describe("Pages preview deployment helpers", () => {
  it("accepts a same-repository feature branch name", () => {
    expect(validatePreviewBranch("issue/1010-authenticated-pr-previews")).toBe(
      "issue/1010-authenticated-pr-previews",
    );
  });

  it.each(["", "main", "staging", "../staging", "refs/heads/staging", "bad branch"])(
    "rejects unsafe preview branch %j",
    (branch) => {
      expect(() => validatePreviewBranch(branch)).toThrow();
    },
  );

  it("extracts the immutable Pages deployment URL", () => {
    const output = [
      "✨ Success! Uploaded 42 files",
      "✨ Deployment complete! Take a peek over at https://a1b2c3d4.linksim-staging.pages.dev",
    ].join("\n");

    expect(parsePagesDeploymentUrl(output, "linksim-staging")).toBe(
      "https://a1b2c3d4.linksim-staging.pages.dev",
    );
  });

  it("does not accept a URL for another Pages project", () => {
    expect(() =>
      parsePagesDeploymentUrl(
        "https://a1b2c3d4.linksim.pages.dev",
        "linksim-staging",
      ),
    ).toThrow();
  });

  it("matches Wrangler's seven-character source for the deployed branch and URL", () => {
    const row = [
      "│ 6b1cae65-74ca-4103-a60d-1c49979690f4",
      "Preview",
      "issue/1010-authenticated-pr-previews",
      "39d6b82",
      "https://6b1cae65.linksim-staging.pages.dev",
      "just now",
      "https://dash.cloudflare.com/example │",
    ].join(" │ ");

    expect(
      hasMatchingPagesDeployment(row, {
        commit: "39d6b825",
        branch: "issue/1010-authenticated-pr-previews",
        deploymentUrl: "https://6b1cae65.linksim-staging.pages.dev",
      }),
    ).toBe(true);
  });

  it.each(["Queued", "Failure"])(
    "rejects a matching deployment whose status is %s",
    (status) => {
      const row = [
        "│ deployment-id",
        "Production",
        "main",
        "39d6b82",
        "https://linksim.pages.dev",
        status,
        "https://dash.cloudflare.com/example │",
      ].join(" │ ");

      expect(
        hasMatchingPagesDeployment(row, {
          commit: "39d6b825",
          branch: "main",
        }),
      ).toBe(false);
    },
  );

  it("rejects a matching commit on the wrong branch or deployment URL", () => {
    const row =
      "│ id │ Preview │ another-branch │ 39d6b82 │ https://other.linksim-staging.pages.dev │";
    expect(
      hasMatchingPagesDeployment(row, {
        commit: "39d6b825",
        branch: "issue/1010-authenticated-pr-previews",
        deploymentUrl: "https://6b1cae65.linksim-staging.pages.dev",
      }),
    ).toBe(false);
  });

  it("uses the full workflow commit for production after its tree matches the release", async () => {
    const workflowCommit = "a".repeat(40);
    const resolveTree = vi.fn(async () => "release-tree");

    await expect(
      resolveDeploymentCommit({
        targetName: "prod-main",
        currentCommit: "12345678",
        workflowCommit,
        resolveTree,
      }),
    ).resolves.toBe(workflowCommit);
    expect(resolveTree).toHaveBeenNthCalledWith(1, workflowCommit);
    expect(resolveTree).toHaveBeenNthCalledWith(2, "HEAD");
  });

  it.each(["", "abc1234", "g".repeat(40), "a".repeat(39), "a".repeat(41)])(
    "rejects malformed production workflow commit %j",
    async (workflowCommit) => {
      const resolveTree = vi.fn();
      await expect(
        resolveDeploymentCommit({
          targetName: "prod-main",
          currentCommit: "12345678",
          workflowCommit,
          resolveTree,
        }),
      ).rejects.toThrow("DEPLOY_VERIFY_COMMIT must be a full 40-character hexadecimal SHA");
      expect(resolveTree).not.toHaveBeenCalled();
    },
  );

  it("rejects a production workflow commit whose tree differs from the release", async () => {
    const workflowCommit = "b".repeat(40);
    const resolveTree = vi.fn(async (ref: string) =>
      ref === "HEAD" ? "release-tree" : "workflow-tree",
    );

    await expect(
      resolveDeploymentCommit({
        targetName: "prod-main",
        currentCommit: "12345678",
        workflowCommit,
        resolveTree,
      }),
    ).rejects.toThrow("workflow commit tree does not match the tagged release worktree");
  });

  it("accepts only the exact deployment commit and branch returned by Wrangler", async () => {
    const commit = "c".repeat(40);
    const listDeployments = vi.fn(async () =>
      `│ deployment-id │ Production │ main │ ${commit} │ https://linksim.pages.dev │ 2 minutes ago │ https://dash.cloudflare.com/example │`,
    );
    const wait = vi.fn();

    await expect(
      verifyMatchingPagesDeployment({
        projectName: "linksim",
        commit,
        branch: "main",
        listDeployments,
        wait,
      }),
    ).resolves.toBeUndefined();
    expect(listDeployments).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("fails closed after retries return only the wrong deployment record", async () => {
    const listDeployments = vi.fn(async () =>
      `│ deployment-id │ Production │ staging │ ${"d".repeat(40)} │ https://linksim.pages.dev │`,
    );
    const wait = vi.fn();

    await expect(
      verifyMatchingPagesDeployment({
        projectName: "linksim",
        commit: "e".repeat(40),
        branch: "main",
        attempts: 3,
        listDeployments,
        wait,
      }),
    ).rejects.toThrow(
      `Post-deploy verification failed: no linksim deployment matched branch main and commit ${"e".repeat(40)}.`,
    );
    expect(listDeployments).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });
});
