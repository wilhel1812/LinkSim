#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

const mode = process.argv.includes("--stop") ? "stop" : "check";
const repoRoot = realpathSync(new URL("..", import.meta.url));
const ownPid = process.pid;

const serverPatterns = [
  /\b(vite|vite\.js)\b/i,
  /\bvitest\b(?!.*\brun\b)/i,
  /\bwrangler\b.*\bpages\b.*\bdev\b/i,
];

const psOutput = execFileSync("ps", ["-eo", "pid=,ppid=,stat=,args="], { encoding: "utf8" });
const candidates = psOutput
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) return null;
    return {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      stat: match[3] ?? "",
      args: match[4] ?? "",
    };
  })
  .filter((entry) => entry && entry.pid !== ownPid)
  .filter((entry) => entry.args.includes(repoRoot))
  .filter((entry) => serverPatterns.some((pattern) => pattern.test(entry.args)));

if (!candidates.length) {
  console.log("[dev-server-guard] No LinkSim dev/watch servers found.");
  process.exit(0);
}

console.log("[dev-server-guard] Found LinkSim dev/watch server process(es):");
for (const entry of candidates) {
  console.log(`- pid=${entry.pid} ppid=${entry.ppid} stat=${entry.stat} ${entry.args}`);
}

if (mode !== "stop") {
  console.log("[dev-server-guard] Run `npm run dev:stop` to terminate them.");
  process.exit(1);
}

for (const entry of candidates) {
  try {
    process.kill(entry.pid, "SIGTERM");
  } catch (error) {
    console.warn(`[dev-server-guard] Failed to SIGTERM pid=${entry.pid}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

setTimeout(() => {
  let failed = false;
  for (const entry of candidates) {
    try {
      process.kill(entry.pid, 0);
      process.kill(entry.pid, "SIGKILL");
      console.warn(`[dev-server-guard] SIGKILL pid=${entry.pid}`);
    } catch {
      // Process exited after SIGTERM.
    }
  }
  if (failed) process.exit(1);
}, 1200);
