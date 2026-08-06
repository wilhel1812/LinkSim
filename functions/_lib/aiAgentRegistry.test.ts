import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Agent = {
  name: string;
  role: string;
  signature: string;
  githubIdentity: Record<string, string>;
  allowedActions: string[];
  prohibitedActions: string[];
};

const registry = JSON.parse(
  readFileSync(resolve(process.cwd(), "config/ai-agents.json"), "utf8"),
) as { schemaVersion: number; markerPrefix: string; agents: Agent[] };

describe("AI agent registry", () => {
  it("defines the stable named crew once", () => {
    expect(registry.schemaVersion).toBe(1);
    expect(registry.markerPrefix).toBe("linksim-ai:v1");
    expect(registry.agents.map((agent) => agent.name)).toEqual([
      "Linky",
      "Scout",
      "Sentry",
      "Forge",
      "Beacon",
      "Steward",
    ]);
  });

  it("requires unique, complete, visibly bot-attributed identities", () => {
    const names = new Set<string>();
    const signatures = new Set<string>();
    for (const agent of registry.agents) {
      expect(agent.name.trim()).not.toBe("");
      expect(agent.role.trim()).not.toBe("");
      expect(agent.signature).toContain(agent.name);
      expect(agent.signature).toMatch(
        /AI (community bot|investigator|reviewer|coding agent|release agent|policy advisor)$/,
      );
      expect(Object.keys(agent.githubIdentity).length).toBeGreaterThan(0);
      expect(agent.allowedActions.length).toBeGreaterThan(0);
      expect(agent.prohibitedActions.length).toBeGreaterThan(0);
      expect(names.has(agent.name)).toBe(false);
      expect(signatures.has(agent.signature)).toBe(false);
      names.add(agent.name);
      signatures.add(agent.signature);
    }
  });

  it("keeps implementation and publication roles from merging autonomously", () => {
    for (const name of ["Linky", "Scout", "Sentry", "Forge"]) {
      expect(registry.agents.find((agent) => agent.name === name)?.prohibitedActions).toContain(
        "merge",
      );
    }
    expect(
      registry.agents.find((agent) => agent.name === "Beacon")?.prohibitedActions,
    ).toContain("promote-without-explicit-approval");
    expect(
      registry.agents.find((agent) => agent.name === "Steward")?.prohibitedActions,
    ).toContain("edit-policy");
  });
});
