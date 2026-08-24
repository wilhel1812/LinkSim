#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ROOT_DOCUMENTATION_FILES = new Set([
  "AGENTS.md",
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
]);

const hasSafeSegments = (path) =>
  path.length > 0 &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  path.split("/").every((segment) => segment && segment !== "." && segment !== "..");

export const isDocumentationOnlyPath = (path) => {
  if (typeof path !== "string" || !hasSafeSegments(path)) return false;
  return ROOT_DOCUMENTATION_FILES.has(path) || path.startsWith("docs/");
};

export const classifyDocumentationPaths = (paths) => {
  const changedPaths = Array.isArray(paths) ? paths.map((path) => String(path)) : [];
  const disallowedPaths = changedPaths.filter((path) => !isDocumentationOnlyPath(path));
  return {
    docsOnly: changedPaths.length > 0 && disallowedPaths.length === 0,
    changedPaths,
    disallowedPaths,
  };
};

const requireCommitSha = (value, label) => {
  const normalized = String(value ?? "").trim();
  if (!COMMIT_SHA_PATTERN.test(normalized) || /^0{40}$/.test(normalized)) {
    throw new Error(`${label} must be a non-zero 40-character commit SHA`);
  }
  return normalized.toLowerCase();
};

const changedPathsBetween = ({ base, head, mode }) => {
  const baseSha = requireCommitSha(base, "base");
  const headSha = requireCommitSha(head, "head");
  if (mode !== "two-dot" && mode !== "three-dot") {
    throw new Error("mode must be two-dot or three-dot");
  }
  const separator = mode === "two-dot" ? ".." : "...";
  const output = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", `${baseSha}${separator}${headSha}`, "--"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return output.split("\0").filter(Boolean);
};

const parseOptions = (args) => {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`invalid CLI option: ${key ?? ""}`);
    }
    options[key.slice(2)] = value;
  }
  return options;
};

const writeGitHubOutput = (result) => {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(
    outputPath,
    `docs_only=${result.docsOnly ? "true" : "false"}\nchanged_count=${result.changedPaths.length}\n`,
  );
};

const runCli = (args) => {
  const [command, ...rest] = args;
  if (command !== "classify" && command !== "require") {
    throw new Error("Usage: docs-only-policy.mjs <classify|require> --base SHA --head SHA --mode <two-dot|three-dot>");
  }
  const options = parseOptions(rest);
  const result = classifyDocumentationPaths(changedPathsBetween(options));
  writeGitHubOutput(result);

  if (result.docsOnly) {
    console.log(`[docs-only-policy] documentation-only (${result.changedPaths.length} path(s))`);
    return;
  }

  const detail = result.disallowedPaths.length
    ? `; disallowed: ${JSON.stringify(result.disallowedPaths)}`
    : "; empty diff";
  if (command === "require") {
    throw new Error(`pull request is not documentation-only${detail}`);
  }
  console.log(`[docs-only-policy] deployment required${detail}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`[docs-only-policy] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
