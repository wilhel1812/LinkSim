#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const RAW_HEADER_PATTERN =
  /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z][0-9]{0,3})$/;
const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);

export const ACTIVATION_BUNDLE_PATHS = Object.freeze([
  ".github/workflows/deploy-pages.yml",
  ".github/workflows/pr-branch-policy.yml",
  "scripts/repository-policy-only.mjs",
  "scripts/repository-policy-only.test.mjs",
  "functions/_lib/docsOnlyWorkflow.test.ts",
  "docs/release-flow.md",
  "docs/documentation-delivery.md",
]);

const ACTIVATION_BUNDLE_PATH_SET = new Set(ACTIVATION_BUNDLE_PATHS);

const hasSafeSegments = (path) =>
  typeof path === "string" &&
  path.length > 0 &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  path.split("/").every((segment) => segment && segment !== "." && segment !== "..");

export const parseRawDiff = (raw) => {
  if (typeof raw !== "string" || raw.length === 0 || !raw.endsWith("\0")) {
    throw new Error("raw diff must be a non-empty NUL-terminated string");
  }
  const fields = raw.split("\0");
  fields.pop();
  if (fields.length === 0 || fields.length % 2 !== 0) {
    throw new Error("raw diff has incomplete records");
  }

  const entries = [];
  for (let index = 0; index < fields.length; index += 2) {
    const match = RAW_HEADER_PATTERN.exec(fields[index]);
    const path = fields[index + 1];
    if (!match || !hasSafeSegments(path)) {
      throw new Error("raw diff contains a malformed record");
    }
    entries.push({
      oldMode: match[1],
      newMode: match[2],
      oldSha: match[3].toLowerCase(),
      newSha: match[4].toLowerCase(),
      status: match[5],
      path,
    });
  }
  return entries;
};

const isAllowedEntry = (entry) => {
  if (!entry || !hasSafeSegments(entry.path)) return false;
  if (!ACTIVATION_BUNDLE_PATH_SET.has(entry.path)) return false;
  if (entry.newObjectType !== "blob") return false;

  if (entry.status === "A") {
    return entry.oldMode === "000000" && REGULAR_BLOB_MODES.has(entry.newMode);
  }
  if (entry.status === "M") {
    return (
      REGULAR_BLOB_MODES.has(entry.oldMode) &&
      REGULAR_BLOB_MODES.has(entry.newMode)
    );
  }
  return false;
};

export const classifyRepositoryPolicyEntries = (entries) => {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  const rejectedEntries = normalizedEntries.filter((entry) => !isAllowedEntry(entry));
  return {
    repositoryPolicyOnly:
      normalizedEntries.length > 0 && rejectedEntries.length === 0,
    changedPaths: normalizedEntries.map((entry) => String(entry?.path ?? "")),
    rejectedEntries,
  };
};

const requireCommitSha = (value, label) => {
  const normalized = String(value ?? "").trim();
  if (!COMMIT_SHA_PATTERN.test(normalized) || /^0{40}$/.test(normalized)) {
    throw new Error(`${label} must be a non-zero 40-character commit SHA`);
  }
  return normalized.toLowerCase();
};

const changedEntriesBetween = ({ base, head, mode }) => {
  const baseSha = requireCommitSha(base, "base");
  const headSha = requireCommitSha(head, "head");
  if (mode !== "two-dot" && mode !== "three-dot") {
    throw new Error("mode must be two-dot or three-dot");
  }
  const separator = mode === "two-dot" ? ".." : "...";
  const raw = execFileSync(
    "git",
    [
      "diff",
      "--raw",
      "--no-abbrev",
      "--no-renames",
      "-z",
      `${baseSha}${separator}${headSha}`,
      "--",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const entries = parseRawDiff(raw);
  return entries.map((entry) => ({
    ...entry,
    newObjectType: execFileSync("git", ["cat-file", "-t", entry.newSha], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim(),
  }));
};

const parseOptions = (args) => {
  if (args.length !== 6) throw new Error("expected --base, --head, and --mode");
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!["--base", "--head", "--mode"].includes(key) || value === undefined) {
      throw new Error(`invalid CLI option: ${key ?? ""}`);
    }
    const normalizedKey = key.slice(2);
    if (normalizedKey in options) throw new Error(`duplicate CLI option: ${key}`);
    options[normalizedKey] = value;
  }
  return options;
};

const writeGitHubOutput = (result) => {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(
    outputPath,
    `repository_policy_only=${result.repositoryPolicyOnly ? "true" : "false"}\n` +
      `repository_policy_changed_count=${result.changedPaths.length}\n`,
  );
};

const runCli = (args) => {
  const [command, ...rest] = args;
  if (command !== "classify") {
    throw new Error(
      "Usage: repository-policy-only.mjs classify --base SHA --head SHA --mode <two-dot|three-dot>",
    );
  }

  let result;
  try {
    result = classifyRepositoryPolicyEntries(changedEntriesBetween(parseOptions(rest)));
  } catch (error) {
    result = {
      repositoryPolicyOnly: false,
      changedPaths: [],
      rejectedEntries: [],
    };
    writeGitHubOutput(result);
    console.error(
      `[repository-policy-only] classification unavailable; deployment required: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }

  writeGitHubOutput(result);
  if (result.repositoryPolicyOnly) {
    console.log(
      `[repository-policy-only] repository-policy-only (${result.changedPaths.length} path(s))`,
    );
    return;
  }
  console.log(
    `[repository-policy-only] deployment required; rejected: ${JSON.stringify(
      result.rejectedEntries.map((entry) => entry?.path ?? "<malformed>"),
    )}`,
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(
      `[repository-policy-only] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
