import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const scannerPath = resolve(process.cwd(), "scripts/security-scan.mjs");
const temporaryRepos: string[] = [];

const createRepo = () => {
  const root = mkdtempSync(join(tmpdir(), "linksim-security-scan-"));
  temporaryRepos.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  return root;
};

const writeTracked = (root: string, relativePath: string, content: string | Buffer) => {
  const path = join(root, relativePath);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content);
  execFileSync("git", ["add", "--", relativePath], { cwd: root });
};

const runScanner = (root: string) =>
  spawnSync(process.execPath, [scannerPath], {
    cwd: root,
    encoding: "utf8",
  });

const fakeToken = () => `ghp_${"A".repeat(30)}`;
const fakeCloudflareToken = () => ["CF_API", "_TOKEN=", "n123456789012345"].join("");

afterEach(() => {
  for (const root of temporaryRepos.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("security scan", () => {
  it("passes a clean tracked repository", () => {
    const root = createRepo();
    writeTracked(root, "src/clean.txt", "ordinary configuration\n");

    const result = runScanner(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No high-risk secret patterns found");
  });

  it("finds secret patterns in tracked hidden files without printing the secret", () => {
    const root = createRepo();
    const token = fakeToken();
    writeTracked(root, ".config/.credentials", `${token}\n`);

    const result = runScanner(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".config/.credentials");
    expect(result.stderr).not.toContain(token);
  });

  it("does not suppress another file whose matching line mentions the scanner", () => {
    const root = createRepo();
    writeTracked(root, "notes with spaces.txt", `scripts/security-scan.mjs: ${fakeToken()}\n`);

    const result = runScanner(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("notes with spaces.txt");
  });

  it("finds Cloudflare tokens containing a lowercase n", () => {
    const root = createRepo();
    writeTracked(root, "cloudflare.env", `${fakeCloudflareToken()}\n`);

    const result = runScanner(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cloudflare.env");
  });

  it("excludes only the scanner source and ignores tracked binary content", () => {
    const root = createRepo();
    writeTracked(root, "scripts/security-scan.mjs", `${fakeToken()}\n`);
    writeTracked(root, "fixtures/blob.bin", Buffer.from(`\0${fakeToken()}\0`, "utf8"));

    const result = runScanner(root);

    expect(result.status).toBe(0);
  });

  it("fails closed when tracked-file discovery cannot run", () => {
    const root = mkdtempSync(join(tmpdir(), "linksim-security-scan-no-git-"));
    temporaryRepos.push(root);

    const result = runScanner(root);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Scan failed");
  });
});
