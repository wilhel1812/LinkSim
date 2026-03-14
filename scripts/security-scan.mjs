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
  "CF_API_TOKEN[=:][^\\n]{12,}",
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

const rgArgs = [
  "-n",
  "-S",
  "-g",
  "!.git",
  "-g",
  "!node_modules",
  "-g",
  "!.wrangler",
  "-g",
  "!dist",
  "-g",
  "!.tmp",
  "-g",
  "!scripts/security-scan.mjs",
  patterns.join("|"),
  ".",
];

const grepArgs = [
  "-R",
  "-n",
  "-E",
  "--binary-files=without-match",
  "--exclude-dir=.git",
  "--exclude-dir=node_modules",
  "--exclude-dir=.wrangler",
  "--exclude-dir=dist",
  "--exclude-dir=.tmp",
  "--exclude=scripts/security-scan.mjs",
  patterns.join("|"),
  ".",
];

const interpretResult = (result, label) => {
  // ripgrep/grep return 1 when no matches are found.
  if (result.code === 1) {
    console.log(`[security-scan] No high-risk secret patterns found (${label}).`);
    process.exit(0);
  }
  if (result.code === 0) {
    console.error("[security-scan] Potential secret material found:");
    process.stderr.write(result.stdout || "");
    process.exit(1);
  }
  console.error(`[security-scan] Scan failed (${label}, ${result.code ?? "unknown"}): ${result.stderr || result.stdout}`);
  process.exit(2);
};

try {
  const rgResult = await run("rg", rgArgs);
  interpretResult(rgResult, "rg");
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  if (code !== "ENOENT") {
    console.error(`[security-scan] Scan failed (rg spawn): ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const grepResult = await run("grep", grepArgs).catch((grepError) => {
    console.error(
      `[security-scan] Scan failed: neither rg nor grep is available (${grepError instanceof Error ? grepError.message : String(grepError)}).`,
    );
    process.exit(2);
  });
  interpretResult(grepResult, "grep");
}
