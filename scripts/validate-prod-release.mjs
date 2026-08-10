#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compareBaseVersions, parseBaseVersion } from "./version-state.mjs";

const root = process.cwd();
const packageJsonPath = path.join(root, "package.json");

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      shell: process.platform === "win32",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(" ")} failed (${code ?? "unknown"}): ${stderr || stdout}`));
    });
  });

const readVersionAtRef = async (ref) => {
  const { stdout } = await run("git", ["show", `${ref}:package.json`]);
  const pkg = JSON.parse(stdout);
  return String(pkg.version ?? "").trim();
};

export const validateReleaseVersionInputs = ({
  version,
  previousProductionVersion,
  hasMatchingHeadTag,
}) => {
  const current = parseBaseVersion(version, "release version");
  const previous = parseBaseVersion(
    previousProductionVersion,
    "previous production version",
  );
  const expectedTag = `v${current.value}`;
  if (!hasMatchingHeadTag) {
    throw new Error(`Prod release gate failed: HEAD must be tagged '${expectedTag}'.`);
  }
  if (compareBaseVersions(current.value, previous.value) <= 0) {
    throw new Error(
      `Prod release gate failed: release version ${current.value} must be newer than ` +
        `previous production ${previous.value}.`,
    );
  }
  return expectedTag;
};

async function main() {
  const pkgText = await readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(pkgText);
  const version = String(pkg.version ?? "").trim();
  parseBaseVersion(version, "release version");

  const expectedTag = `v${version}`;
  const { stdout: tagsAtHead } = await run("git", ["tag", "--points-at", "HEAD"]);
  const hasMatchingHeadTag = tagsAtHead
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .includes(expectedTag);
  const previousProductionRef =
    String(process.env.PRODUCTION_PREVIOUS_REF ?? "").trim() || "origin/main^";
  const previousProductionVersion = await readVersionAtRef(previousProductionRef);
  validateReleaseVersionInputs({
    version,
    previousProductionVersion,
    hasMatchingHeadTag,
  });

  console.log(
    `[validate-prod-release] ok version=${version} previous=${previousProductionVersion} tag=${expectedTag}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[validate-prod-release] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
