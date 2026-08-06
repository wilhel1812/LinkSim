import { describe, expect, it } from "vitest";
import {
  hasMatchingPagesDeployment,
  parsePagesDeploymentUrl,
  validatePreviewBranch,
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
      "https://6b1cae65.linksim-staging.pages.dev │",
    ].join(" │ ");

    expect(
      hasMatchingPagesDeployment(row, {
        commit: "39d6b825",
        branch: "issue/1010-authenticated-pr-previews",
        deploymentUrl: "https://6b1cae65.linksim-staging.pages.dev",
      }),
    ).toBe(true);
  });

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
});
