#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

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

async function main() {
  const pkgText = await readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(pkgText);
  const version = String(pkg.version ?? "").trim();
  if (!version) {
    throw new Error("Prod release gate failed: package.json version is missing.");
  }

  const expectedTag = `v${version}`;
  const { stdout: tagsAtHead } = await run("git", ["tag", "--points-at", "HEAD"]);
  const hasMatchingHeadTag = tagsAtHead
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .includes(expectedTag);
  if (!hasMatchingHeadTag) {
    throw new Error(`Prod release gate failed: HEAD must be tagged '${expectedTag}'.`);
  }

  const parentCheck = await run("git", ["rev-list", "--count", "HEAD"]);
  const commitCount = Number.parseInt(parentCheck.stdout.trim(), 10);
  if (!Number.isFinite(commitCount) || commitCount < 2) {
    throw new Error("Prod release gate failed: cannot verify version bump on first commit.");
  }

  const versionAtHead = await readVersionAtRef("HEAD");
  const versionAtParent = await readVersionAtRef("HEAD^");
  if (versionAtHead === versionAtParent) {
    throw new Error(`Prod release gate failed: package version was not bumped in HEAD (still ${versionAtHead}).`);
  }

  console.log(`[validate-prod-release] ok version=${version} tag=${expectedTag}`);
}

main().catch((error) => {
  console.error(`[validate-prod-release] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
