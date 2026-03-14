#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const expectedVersion = String(pkg.version ?? "").trim();

const extractVersion = (filePath) => {
  const content = readFileSync(filePath, "utf8");
  const match = content.match(/APP_VERSION\s*=\s*"([^"]+)"/);
  return match?.[1] ?? "";
};

const srcVersion = extractVersion(resolve(root, "src/lib/buildInfo.ts"));
const functionsVersion = extractVersion(resolve(root, "functions/_lib/buildInfo.ts"));

if (!expectedVersion) {
  console.error("[build-info:verify] package.json version missing");
  process.exit(1);
}
if (srcVersion !== expectedVersion || functionsVersion !== expectedVersion) {
  console.error(
    `[build-info:verify] version mismatch: package=${expectedVersion}, src=${srcVersion || "-"}, functions=${functionsVersion || "-"}`,
  );
  console.error("Run: npm run build:meta");
  process.exit(1);
}
console.log(`[build-info:verify] ok (${expectedVersion})`);
