/// <reference types="node" />

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const scriptPath = resolve(process.cwd(), "scripts/staging-drift-policy.mjs");

const evaluatePolicy = (expression: string) => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { isNormalStagingPromotion, shouldOpenStagingDriftIssue } from ${JSON.stringify(scriptPath)};
       const result = ${expression};
       console.log(JSON.stringify(result));`,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output) as unknown;
};

describe("staging drift policy", () => {
  it("does not open a drift issue for a squash-merged staging to main promotion", () => {
    const result = evaluatePolicy(`shouldOpenStagingDriftIssue({
      driftCount: 1,
      associatedPullRequests: [
        {
          head: { ref: "staging" },
          base: { ref: "main" },
          merged_at: "2026-04-27T12:00:00Z",
          html_url: "https://github.com/wilhel1812/LinkSim/pull/769",
        },
      ],
    })`) as { openIssue: boolean; reason: string };

    expect(result.openIssue).toBe(false);
    expect(result.reason).toContain("staging->main");
  });

  it("opens a drift issue for hotfix or other non-staging main pushes", () => {
    const result = evaluatePolicy(`shouldOpenStagingDriftIssue({
      driftCount: 1,
      associatedPullRequests: [
        {
          head: { ref: "hotfix/auth-timeout" },
          base: { ref: "main" },
          merged_at: "2026-04-27T12:00:00Z",
        },
      ],
    })`) as { openIssue: boolean };

    expect(result.openIssue).toBe(true);
  });

  it("does not open a drift issue when there are no main-only commits", () => {
    const result = evaluatePolicy(`shouldOpenStagingDriftIssue({
      driftCount: 0,
      associatedPullRequests: [],
    })`) as { openIssue: boolean };

    expect(result.openIssue).toBe(false);
  });

  it("recognizes associated pull request shapes from the GitHub API and GraphQL-style data", () => {
    expect(
      evaluatePolicy(`isNormalStagingPromotion({
        head: { ref: "staging" },
        base: { ref: "main" },
        merged_at: "2026-04-27T12:00:00Z",
      })`),
    ).toBe(true);
    expect(
      evaluatePolicy(`isNormalStagingPromotion({
        headRefName: "staging",
        baseRefName: "main",
        mergedAt: "2026-04-27T12:00:00Z",
      })`),
    ).toBe(true);
  });
});
