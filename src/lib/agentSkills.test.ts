import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function skill(name: string): string {
  return readFileSync(resolve(process.cwd(), ".agents", "skills", name, "SKILL.md"), "utf8");
}

describe("Forge workflow skills", () => {
  it("bounds epic execution to one explicitly approved, independently mergeable phase", () => {
    const text = skill("linksim-execute-epic");

    expect(text).toContain("name: linksim-execute-epic");
    expect(text).toMatch(/explicit(?:ly)? approved phase/i);
    expect(text).toMatch(/dedicated worktree/i);
    expect(text).toMatch(/reuse-first architect/i);
    expect(text).toMatch(/bounded implementers/i);
    expect(text).toMatch(/at most two (?:bounded )?implementers/i);
    expect(text).toMatch(/orchestrator diff and test review/i);
    expect(text).toMatch(/at most three correction rounds/i);
    expect(text).toMatch(/independently mergeable/i);
    expect(text).toMatch(/validated epic\s+handoff mode/i);
    expect(text).toMatch(/never merge/i);
    expect(text).toMatch(/run production/i);
  });

  it("requires an independent read-only pre-PR review for risky changes", () => {
    const text = skill("linksim-pre-pr-review");

    expect(text).toContain("name: linksim-pre-pr-review");
    expect(text).toMatch(/separate Codex context/i);
    expect(text).toMatch(/read-only/i);
    expect(text).toMatch(/code, authentication, database, workflow, and release change/i);
    expect(text).toMatch(/mechanical documentation-only/i);
    expect(text).toMatch(/must not modify/i);
    expect(text).toMatch(/file and line/i);
    expect(text).toMatch(/verdict covers only the reported head SHA/i);
  });

  it("makes pre-PR review an explicit publication gate", () => {
    const createPr = skill("linksim-create-pr");

    expect(createPr).toContain("$linksim-pre-pr-review");
    expect(createPr).toMatch(/candidate commit SHA/i);
    expect(createPr).toMatch(/reviewed head equals\s+`HEAD`/i);
    expect(createPr).toMatch(/validated epic handoff/i);
    expect(createPr).toMatch(/do not recreate/i);
  });
});
