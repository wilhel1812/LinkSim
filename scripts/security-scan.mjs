#!/usr/bin/env node
import { spawn } from "node:child_process";

const root = process.cwd();
const patterns = [
  "BEGIN RSA PRIVATE KEY",
  "BEGIN OPENSSH PRIVATE KEY",
  "BEGIN PRIVATE KEY",
  "ghp_[A-Za-z0-9]{30,}",
  "github_pat_[A-Za-z0-9_]{20,}",
  "sk_live_[A-Za-z0-9]{16,}",
  "xox[baprs]-[A-Za-z0-9-]{10,}",
  "AKIA[0-9A-Z]{16}",
  "AIza[0-9A-Za-z_-]{20,}",
  "CF_API_TOKEN[=:].{12,}",
];

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      shell: process.platform === "win32",
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
    child.on("error", (error) => reject(error));
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });

const gitGrepArgs = [
  "grep",
  "-n",
  "-I",
  "-l",
  "-E",
  "-e",
  patterns.join("|"),
  "--",
  ".",
  ":(exclude)scripts/security-scan.mjs",
];

const interpretResult = (result) => {
  // git grep returns 1 when no tracked file contains a match.
  if (result.code === 1) {
    console.log("[security-scan] No high-risk secret patterns found (tracked files).");
    process.exit(0);
  }
  if (result.code === 0) {
    console.error("[security-scan] Potential secret material found in tracked files:");
    process.stderr.write(result.stdout);
    process.stderr.write("\n");
    process.exit(1);
  }
  console.error(
    `[security-scan] Scan failed (git grep, ${result.code ?? "unknown"}): ${result.stderr || result.stdout}`,
  );
  process.exit(2);
};

try {
  const result = await run("git", gitGrepArgs);
  interpretResult(result);
} catch (error) {
  console.error(
    `[security-scan] Scan failed (git spawn): ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(2);
}
