import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(resolve(process.cwd(), "config/steward-policy-audit.json"), "utf8"),
);
const policySkill = readFileSync(
  resolve(process.cwd(), ".agents/skills/linksim-policy-audit/SKILL.md"),
  "utf8",
);
const repositoryPolicy = readFileSync(resolve(process.cwd(), "AGENTS.md"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
const qualityWorkflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/ci-quality-gates.yml"),
  "utf8",
);

describe("Steward policy audit rollout", () => {
  it("uses one durable discussion issue and remains fail-closed without a pre-model guard", () => {
    expect(config.schemaVersion).toBe(1);
    expect(config.discussionIssue).toBe(1027);
    expect(config.cadence).toBe("weekly");
    expect(config.enabled).toBe(false);
    expect(config.executor).toBe("unconfigured");
    expect(config.preModelGuard.requiredState).toBe("normal");
    expect(config.preModelGuard.minimumRemainingPercentExclusive).toBe(25);
    expect(config.preModelGuard.maximumTelemetryAgeSeconds).toBe(600);
    expect(config.publication).toEqual({
      appendOnly: true,
      evidenceRequired: true,
      idempotentByAuditWindow: true,
      publishWhenNoSuggestion: false,
      signedAgent: "Steward",
    });
  });

  it("routes every publication through the shared deterministic validator", () => {
    expect(policySkill).toContain("scripts/ai-provenance.mjs");
    expect(policySkill).toContain("config/steward-policy-audit.json");
    expect(repositoryPolicy).toContain("scripts/ai-provenance.mjs");
    expect(repositoryPolicy).toContain("fail closed");
    expect(packageJson.scripts["agents:validate"]).toBe(
      "node scripts/ai-provenance.mjs validate-registry",
    );
    expect(qualityWorkflow).toContain("npm run agents:validate");
  });
});
