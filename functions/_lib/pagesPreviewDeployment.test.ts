import { describe, expect, it } from "vitest";
import { parsePagesDeploymentUrl, validatePreviewBranch } from "../../scripts/pages-preview.mjs";

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
});
