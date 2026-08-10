#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  parsePackageVersionInputs,
  validatePackageVersionParity,
} from "./version-state.mjs";

const root = process.cwd();

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

export const validatePromotionInputs = ({
  version,
  lockfileVersion,
  lockfileRootVersion,
  tagCommit,
  treesMatch,
}) => {
  let normalizedVersion;
  try {
    normalizedVersion = validatePackageVersionParity({
      packageVersion: version,
      lockfileVersion,
      lockfileRootVersion,
      label: "production",
    });
  } catch (error) {
    throw new Error(`Prod promotion gate failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!String(tagCommit ?? "").trim()) {
    throw new Error(`Prod promotion gate failed: release tag v${normalizedVersion} does not exist.`);
  }
  if (!treesMatch) {
    throw new Error(
      `Prod promotion gate failed: main HEAD tree differs from release tag v${normalizedVersion}. ` +
        "Do not deploy production-only changes; recreate the promotion from the verified staging release tree.",
    );
  }
  return `v${normalizedVersion}`;
};

async function main() {
  const versionInputs = parsePackageVersionInputs(
    await readFile(path.join(root, "package.json"), "utf8"),
    await readFile(path.join(root, "package-lock.json"), "utf8"),
  );
  const version = validatePackageVersionParity({
    ...versionInputs,
    label: "production",
  });
  const tag = `v${version}`;
  const tagCommit = (await run("git", ["rev-parse", "--verify", `${tag}^{commit}`])).stdout.trim();
  let treesMatch = true;
  try {
    await run("git", ["diff", "--quiet", "HEAD", tag, "--"]);
  } catch {
    treesMatch = false;
  }

  validatePromotionInputs({
    version,
    lockfileVersion: versionInputs.lockfileVersion,
    lockfileRootVersion: versionInputs.lockfileRootVersion,
    tagCommit,
    treesMatch,
  });
  console.log(`[validate-prod-promotion] ok tag=${tag} tagCommit=${tagCommit.slice(0, 8)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[validate-prod-promotion] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
