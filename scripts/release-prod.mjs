#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const packageJsonPath = path.join(root, "package.json");

const parseArg = (name) => {
  const direct = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (direct) return direct.split("=").slice(1).join("=");
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1];
  return "";
};

const run = (cmd, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      shell: process.platform === "win32",
      env: process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });

    if (options.capture) {
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
      return;
    }

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout: "", stderr: "" });
      else reject(new Error(`${cmd} ${args.join(" ")} failed (${code ?? "unknown"})`));
    });
  });

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function main() {
  const bump = parseArg("bump") || "patch";
  assert(
    bump === "patch" || bump === "minor" || bump === "major",
    "Invalid --bump value. Allowed: patch, minor, major",
  );

  const { stdout: branchStdout } = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { capture: true });
  const branch = branchStdout.trim();
  assert(branch === "main", "Release flow requires current branch to be 'main'.");

  const { stdout: statusStdout } = await run("git", ["status", "--porcelain"], { capture: true });
  assert(statusStdout.trim().length === 0, "Release flow requires a clean git working tree.");

  const packageBefore = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const versionBefore = String(packageBefore.version ?? "").trim();
  assert(versionBefore.length > 0, "package.json version is missing.");

  await run("npm", ["version", bump, "--no-git-tag-version"]);
  await run("npm", ["run", "build:meta"]);

  const packageAfter = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const versionAfter = String(packageAfter.version ?? "").trim();
  assert(versionAfter !== versionBefore, "Version bump did not change package.json version.");

  const tag = `v${versionAfter}`;
  await run("git", ["add", "package.json", "package-lock.json", "src/lib/buildInfo.ts", "functions/_lib/buildInfo.ts"]);
  await run("git", ["commit", "-m", `release: bump version to ${versionAfter}`]);
  await run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
  await run("git", ["push", "origin", "main", "--follow-tags"]);

  await run("npm", ["run", "deploy:staging:main"]);
  await run("npm", ["run", "deploy:prod:main"]);
}

main().catch(async (error) => {
  console.error(`[release:prod] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
