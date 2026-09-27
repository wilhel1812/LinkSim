/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")) as Record<string, unknown>;

describe("MapLibre runtime dependency compatibility", () => {
  it("pins the patched MapLibre runtime with a React adapter that supports v6", () => {
    const packageJson = readJson("package.json") as {
      dependencies: Record<string, string>;
    };
    const packageLock = readJson("package-lock.json") as {
      packages: Record<string, { version?: string }>;
    };

    expect(packageJson.dependencies["maplibre-gl"]).toBe("6.4.1");
    expect(packageJson.dependencies["react-map-gl"]).toBe("8.1.2");
    expect(packageLock.packages["node_modules/maplibre-gl"]?.version).toBe("6.4.1");
    expect(packageLock.packages["node_modules/react-map-gl"]?.version).toBe("8.1.2");
    expect(packageLock.packages["node_modules/@vis.gl/react-maplibre"]?.version).toBe("8.1.2");
  });
});
