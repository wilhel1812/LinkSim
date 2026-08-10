import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadKnowledgeRegistry,
  selectKnowledgeForAgent,
  validateKnowledgeRegistry,
} from "../../scripts/ai-knowledge.mjs";

const agentRegistry = JSON.parse(
  readFileSync(resolve(process.cwd(), "config/ai-agents.json"), "utf8"),
);

describe("reviewed AI role knowledge", () => {
  it("ships the six human-approved lessons from the crew follow-up", () => {
    const registry = loadKnowledgeRegistry();

    expect(registry.entries.map((entry: { id: string }) => entry.id)).toEqual([
      "preserve-reporter-intent",
      "ask-instead-of-inventing",
      "resolve-conversations-independently",
      "keep-community-replies-concise",
      "hide-internal-scout-reports",
      "ground-product-claims",
    ]);
    expect(registry.entries.every((entry: { status: string }) => entry.status === "approved")).toBe(true);
    expect(registry.entries.every((entry: { humanApproval: { by: string } }) => entry.humanApproval.by === "wilhel1812")).toBe(true);
  });

  it("rejects unknown agents, missing approval, and transcript-shaped fields", () => {
    const base = {
      schemaVersion: 1,
      maxLoadedCharacters: 512,
      entries: [
        {
          id: "one-lesson",
          lesson: "Keep the answer grounded.",
          affectedAgents: ["Linky"],
          evidence: ["issue-1035"],
          humanApproval: {
            by: "wilhel1812",
            source: "issue-1035",
            approvedAt: "2026-08-10",
          },
          status: "approved",
        },
      ],
    };

    expect(() =>
      validateKnowledgeRegistry(
        { ...base, entries: [{ ...base.entries[0], affectedAgents: ["Unknown"] }] },
        agentRegistry,
      ),
    ).toThrow(/unknown agent/i);
    expect(() =>
      validateKnowledgeRegistry(
        { ...base, entries: [{ ...base.entries[0], humanApproval: undefined }] },
        agentRegistry,
      ),
    ).toThrow(/human approval/i);
    expect(() =>
      validateKnowledgeRegistry(
        { ...base, entries: [{ ...base.entries[0], transcript: "raw chat" }] },
        agentRegistry,
      ),
    ).toThrow(/unsupported field/i);
  });

  it("loads only approved entries for one agent under the strict character cap", () => {
    const registry = validateKnowledgeRegistry(
      {
        schemaVersion: 1,
        maxLoadedCharacters: 256,
        entries: [
          {
            id: "link-only",
            lesson: "A".repeat(150),
            affectedAgents: ["Linky"],
            evidence: ["issue-1"],
            humanApproval: { by: "owner", source: "issue-1", approvedAt: "2026-08-10" },
            status: "approved",
          },
          {
            id: "retired-link",
            lesson: "Do not load retired advice.",
            affectedAgents: ["Linky"],
            evidence: ["issue-2"],
            humanApproval: { by: "owner", source: "issue-2", approvedAt: "2026-08-10" },
            status: "retired",
          },
          {
            id: "forge-only",
            lesson: "Do not load another role's advice.",
            affectedAgents: ["Forge"],
            evidence: ["issue-3"],
            humanApproval: { by: "owner", source: "issue-3", approvedAt: "2026-08-10" },
            status: "approved",
          },
          {
            id: "link-over-cap",
            lesson: "B".repeat(150),
            affectedAgents: ["Linky"],
            evidence: ["issue-4"],
            humanApproval: { by: "owner", source: "issue-4", approvedAt: "2026-08-10" },
            status: "approved",
          },
        ],
      },
      agentRegistry,
    );

    const selected = selectKnowledgeForAgent(registry, "Linky");
    expect(selected.entries.map((entry: { id: string }) => entry.id)).toEqual(["link-only"]);
    expect(selected.characters).toBeLessThanOrEqual(256);
    expect(selected.truncated).toBe(true);
  });

  it("keeps Steward suggestion-only and requires an approved Forge edit", () => {
    const steward = readFileSync(
      resolve(process.cwd(), ".agents/skills/linksim-policy-audit/SKILL.md"),
      "utf8",
    );
    const createPr = readFileSync(
      resolve(process.cwd(), ".agents/skills/linksim-create-pr/SKILL.md"),
      "utf8",
    );
    const policy = readFileSync(resolve(process.cwd(), "AGENTS.md"), "utf8");

    expect(steward).toMatch(/suggest[\s\S]{0,80}knowledge\s+registry/i);
    expect(steward).toMatch(/never[\s\S]{0,80}edit[\s\S]{0,80}knowledge registry/i);
    expect(createPr).toMatch(/approved Forge[\s\S]{0,100}knowledge registry/i);
    expect(policy).toContain("node scripts/ai-knowledge.mjs for-agent --agent <name>");
    expect(policy).toMatch(/do not store.*raw chat transcripts/i);
  });
});
