import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceFiles = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
  const path = resolve(directory, name);
  return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
});

describe("private basemap preference boundary", () => {
  it("allows only /api/me to request the private profile shape", () => {
    const apiRoot = resolve(process.cwd(), "functions/api");
    const privateReaders = sourceFiles(apiRoot).filter((path) => readFileSync(path, "utf8").includes("fetchMyUserProfile"));
    expect(privateReaders).toEqual([resolve(apiRoot, "me.ts")]);
  });

  it("keeps the private field out of public API source contracts", () => {
    const apiRoot = resolve(process.cwd(), "functions/api");
    const exposed = sourceFiles(apiRoot)
      .filter((path) => path !== resolve(apiRoot, "me.ts"))
      .filter((path) => readFileSync(path, "utf8").includes("basemapPreferences"));
    expect(exposed).toEqual([]);
  });
});
