import { readdirSync, readFileSync } from "node:fs";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const workflowsUrl = new URL("../.github/workflows/", import.meta.url);
const fullCommitSha = /^[0-9a-f]{40}$/;

function externalActionReferences(source) {
  const references = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;

    for (const [key, child] of Object.entries(value)) {
      if (key === "uses" && typeof child === "string" && !child.startsWith("./")) {
        references.push(child);
      }
      visit(child);
    }
  };

  yaml.loadAll(source, visit);
  return references;
}

function unpinnedReferences(source) {
  return externalActionReferences(source).filter((reference) => {
    const separator = reference.lastIndexOf("@");
    return separator < 1 || !fullCommitSha.test(reference.slice(separator + 1));
  });
}

describe("GitHub Actions dependency pins", () => {
  it("rejects a floating external action reference while allowing local actions", () => {
    const source = [
      "steps:",
      "  - uses: actions/checkout@v4",
      '  - "uses": actions/setup-node@v4',
      '  - uses : "actions/github-script@v7"',
      '  - "uses" : "./actions/local"',
    ].join("\n");

    expect(unpinnedReferences(source)).toEqual([
      "actions/checkout@v4",
      "actions/setup-node@v4",
      "actions/github-script@v7",
    ]);
  });

  it("pins every external workflow action to a documented full commit SHA", () => {
    const workflowFiles = readdirSync(workflowsUrl)
      .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
      .sort();
    const inventory = workflowFiles.flatMap((name) => {
      const source = readFileSync(new URL(name, workflowsUrl), "utf8");
      return externalActionReferences(source).map((reference) => ({ name, reference }));
    });
    const unpinned = inventory.filter(({ reference }) => {
      const separator = reference.lastIndexOf("@");
      return separator < 1 || !fullCommitSha.test(reference.slice(separator + 1));
    });

    expect(inventory.length).toBeGreaterThan(0);
    expect(unpinned, JSON.stringify(unpinned, null, 2)).toEqual([]);

    for (const { name, reference } of inventory) {
      const source = readFileSync(new URL(name, workflowsUrl), "utf8");
      expect(source).toContain(`uses: ${reference} # v`);
    }
  });
});
