import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  formatArtifactFooter,
  formatProvenanceMarker,
  loadAgentRegistry,
  validateAgentRegistry,
  validateSignedArtifact,
} from "../../scripts/ai-provenance.mjs";

const registryPath = resolve(process.cwd(), "config/ai-agents.json");
const validRun = "19196eb1-92e6-49d1-944f-da1564941235";
const validCommit = "810a698227512a06c7e6e22392f93c7623174030";

describe("AI provenance contract", () => {
  it("loads and validates the checked-in registry as the single source of truth", () => {
    const registry = loadAgentRegistry(registryPath);

    expect(registry.agents.map((agent) => agent.name)).toEqual([
      "Linky",
      "Scout",
      "Sentry",
      "Forge",
      "Beacon",
      "Steward",
    ]);
    expect(
      registry.agents.find((agent) => agent.name === "Steward")?.githubIdentity
        .scheduledPublisher,
    ).toEqual({ kind: "relayed-by", agent: "Linky" });
    expect(validateAgentRegistry(registry)).toBe(registry);
  });

  it("formats and validates a complete visible and machine-readable footer", () => {
    const registry = loadAgentRegistry(registryPath);
    const footer = formatArtifactFooter(registry, {
      agent: "Steward",
      run: validRun,
      source: "LinkSim-1015-weekly",
      commit: validCommit,
    });

    expect(footer.signature).toBe("— Steward · AI policy advisor");
    expect(footer.marker).toBe(
      `<!-- linksim-ai:v1 agent=Steward bot=true run=${validRun} source=LinkSim-1015-weekly commit=${validCommit} -->`,
    );
    expect(
      validateSignedArtifact(registry, `${footer.signature}\n${footer.marker}`, {
        expectedAgent: "Steward",
      }),
    ).toEqual({
      agent: "Steward",
      run: validRun,
      source: "LinkSim-1015-weekly",
      commit: validCommit,
    });
  });

  it("fails closed for unsigned, falsely attributed, malformed, or unknown artifacts", () => {
    const registry = loadAgentRegistry(registryPath);
    const marker = formatProvenanceMarker(registry, {
      agent: "Forge",
      run: validRun,
      source: "pull-request-42",
      commit: validCommit,
    });

    expect(() => validateSignedArtifact(registry, marker)).toThrow("visible signature");
    expect(() =>
      validateSignedArtifact(registry, `— Beacon · AI release agent\n${marker}`),
    ).toThrow("visible signature");
    expect(() =>
      formatProvenanceMarker(registry, {
        agent: "Unknown",
        run: validRun,
        source: "test",
        commit: validCommit,
      }),
    ).toThrow("unknown agent");
    expect(() =>
      formatProvenanceMarker(registry, {
        agent: "Forge",
        run: "not-a-run-id",
        source: "test",
        commit: validCommit,
      }),
    ).toThrow("run ID");
    expect(() =>
      formatProvenanceMarker(registry, {
        agent: "Forge",
        run: validRun,
        source: "unsafe source",
        commit: validCommit,
      }),
    ).toThrow("source");
    expect(() =>
      formatProvenanceMarker(registry, {
        agent: "Forge",
        run: validRun,
        source: "test",
        commit: "short",
      }),
    ).toThrow("commit SHA");
    expect(() =>
      validateSignedArtifact(
        registry,
        `— Forge · AI coding agent\n${marker}\n<!-- linksim-ai:v1 malformed -->`,
      ),
    ).toThrow("exactly one provenance marker");
  });

  it("rejects registry drift, duplicate authority, and broken relay identities", () => {
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    registry.agents[0].allowedActions.push(registry.agents[0].prohibitedActions[0]);
    expect(() => validateAgentRegistry(registry)).toThrow("both allowed and prohibited");

    const brokenRelay = JSON.parse(readFileSync(registryPath, "utf8"));
    brokenRelay.agents.find((agent: { name: string }) => agent.name === "Scout").githubIdentity.agent =
      "Nobody";
    expect(() => validateAgentRegistry(brokenRelay)).toThrow("unknown relay agent");

    const brokenScheduledPublisher = JSON.parse(readFileSync(registryPath, "utf8"));
    brokenScheduledPublisher.agents.find(
      (agent: { name: string }) => agent.name === "Steward",
    ).githubIdentity.scheduledPublisher = { kind: "relayed-by", agent: "Nobody" };
    expect(() => validateAgentRegistry(brokenScheduledPublisher)).toThrow(
      "unknown scheduled publisher agent",
    );
  });

  it("offers a deterministic CLI for workflows and Codex skills", () => {
    const output = execFileSync(
      process.execPath,
      [
        "scripts/ai-provenance.mjs",
        "footer",
        "--agent",
        "Beacon",
        "--run",
        validRun,
        "--source",
        "pull-request-42",
        "--commit",
        validCommit,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const footer = JSON.parse(output);

    expect(footer.signature).toBe("— Beacon · AI release agent");
    expect(footer.marker).toContain("agent=Beacon bot=true");
  });
});
