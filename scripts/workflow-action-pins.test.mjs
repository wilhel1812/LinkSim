import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflowsUrl = new URL("../.github/workflows/", import.meta.url);
const fullCommitSha = /^[0-9a-f]{40}$/;

function externalActionReferences(source) {
  return [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#\s*(\S.*))?$/gm)]
    .map((match) => ({ reference: match[1], comment: match[2] ?? "" }))
    .filter(({ reference }) => !reference.startsWith("./"));
}

function unpinnedReferences(source) {
  return externalActionReferences(source).filter(({ reference }) => {
    const separator = reference.lastIndexOf("@");
    return separator < 1 || !fullCommitSha.test(reference.slice(separator + 1));
  });
}

describe("GitHub Actions dependency pins", () => {
  it("rejects a floating external action reference while allowing local actions", () => {
    const source = [
      "steps:",
      "  - uses: actions/checkout@v4",
      "  - uses: ./actions/local",
    ].join("\n");

    expect(unpinnedReferences(source)).toEqual([
      { reference: "actions/checkout@v4", comment: "" },
    ]);
  });

  it("pins every external workflow action to a documented full commit SHA", () => {
    const workflowFiles = readdirSync(workflowsUrl)
      .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
      .sort();
    const inventory = workflowFiles.flatMap((name) => {
      const source = readFileSync(new URL(name, workflowsUrl), "utf8");
      return externalActionReferences(source).map((entry) => ({ name, ...entry }));
    });
    const unpinned = inventory.filter(({ reference }) => {
      const separator = reference.lastIndexOf("@");
      return separator < 1 || !fullCommitSha.test(reference.slice(separator + 1));
    });

    expect(inventory.length).toBeGreaterThan(0);
    expect(unpinned, JSON.stringify(unpinned, null, 2)).toEqual([]);
    expect(inventory.every(({ comment }) => /^v\d/.test(comment))).toBe(true);
  });
});
