#!/usr/bin/env node
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const shortSha = (() => {
  const envSha = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || "";
  if (envSha.trim()) return envSha.trim().slice(0, 8);
  try {
    return execSync("git rev-parse --short=8 HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString("utf8")
      .trim();
  } catch {
    return "unknown";
  }
})();

const version = String(pkg.version ?? "0.0.0");

mkdirSync(resolve(root, ".tmp"), { recursive: true });

const content = `export const APP_VERSION = "${version}";
export const APP_COMMIT = "${shortSha}";
export const APP_BUILD_LABEL = \`v\${APP_VERSION}+\${APP_COMMIT}\`;
export type BuildChannel = "stable" | "beta" | "alpha";
export const buildLabelForChannel = (channel: BuildChannel): string => {
  if (channel === "stable") return \`v\${APP_VERSION}\`;
  return \`v\${APP_VERSION}-\${channel}+\${APP_COMMIT}\`;
};
`;

writeFileSync(resolve(root, ".tmp/buildInfo.ts"), content, "utf8");
console.log(`[build-info] ${version}+${shortSha}`);
