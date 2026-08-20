import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("site notice workflow command", () => {
  it("uses the online D1 query path instead of database import", () => {
    const source = readFileSync(new URL("./site-notice.mjs", import.meta.url), "utf8");

    expect(source).toContain('"--command", sql');
    expect(source).not.toContain('"--file"');
  });
});
