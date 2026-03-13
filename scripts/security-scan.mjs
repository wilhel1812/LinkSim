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

const args = [
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

const child = spawn("rg", args, {
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

child.on("exit", (code) => {
  // rg returns 1 when no matches found.
  if (code === 1) {
    console.log("[security-scan] No high-risk secret patterns found.");
    process.exit(0);
  }
  if (code === 0) {
    console.error("[security-scan] Potential secret material found:");
    process.stderr.write(stdout || "");
    process.exit(1);
  }
  console.error(`[security-scan] Scan failed (${code ?? "unknown"}): ${stderr || stdout}`);
  process.exit(2);
});
