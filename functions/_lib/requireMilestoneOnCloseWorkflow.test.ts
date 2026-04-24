import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("require milestone on close workflow", () => {
  it("honors the no-milestone-close-ok exception label by name", () => {
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/require-milestone-on-close.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      "contains(github.event.issue.labels.*.name, 'no-milestone-close-ok')",
    );
    expect(workflow).not.toContain("toJson(github.event.issue.labels)");
  });
});
