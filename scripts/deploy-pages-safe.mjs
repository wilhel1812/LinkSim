import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const wranglerProd = path.join(root, "wrangler.toml");
const wranglerStaging = path.join(root, "wrangler.staging.toml");
const wranglerBackup = path.join(root, "wrangler.toml.__deploy_backup__");
const distDir = path.join(root, "dist");
const releaseManifestPath = path.join(distDir, "release.json");

const TARGETS = {
  "staging-preview": {
    projectName: "linksim-staging",
    branch: "CURRENT",
    requireMainBranch: false,
    configPath: wranglerStaging,
    environmentLabel: "staging-preview",
    expected: {
      name: "linksim-staging",
      databaseName: "linksim_staging",
      bucketName: "linksim-avatars-staging",
    },
  },
  "staging-main": {
    projectName: "linksim-staging",
    branch: "main",
    requireMainBranch: true,
    configPath: wranglerStaging,
    environmentLabel: "staging-main",
    expected: {
      name: "linksim-staging",
      databaseName: "linksim_staging",
      bucketName: "linksim-avatars-staging",
    },
  },
  "prod-main": {
    projectName: "linksim",
    branch: "main",
    requireMainBranch: true,
    configPath: wranglerProd,
    environmentLabel: "production-main",
    expected: {
      name: "linksim",
      databaseName: "linksim",
      bucketName: "linksim-avatars",
    },
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = (cmd, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: process.platform === "win32",
      env: process.env,
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
      child.on("exit", (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`${cmd} ${args.join(" ")} failed (${code ?? "unknown"}): ${stderr || stdout}`));
      });
      child.on("error", reject);
      return;
    }
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout: "", stderr: "" });
      else reject(new Error(`${cmd} ${args.join(" ")} failed (${code ?? "unknown"})`));
    });
    child.on("error", reject);
  });

const parseArg = (name) => {
  const direct = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (direct) return direct.split("=").slice(1).join("=");
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1];
  return "";
};

const parseTomlValue = (content, key) => {
  const line = content
    .split("\n")
    .map((row) => row.trim())
    .find((row) => row.startsWith(`${key} = `));
  if (!line) return "";
  const match = line.match(/=\s*"([^"]+)"/);
  return match ? match[1] : "";
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function getGitRef(args = ["rev-parse", "--abbrev-ref", "HEAD"]) {
  const { stdout } = await run("git", args, { capture: true });
  return stdout.trim();
}

async function preflight(targetName, target) {
  const branch = await getGitRef();
  const commit = await getGitRef(["rev-parse", "--short", "HEAD"]);
  const status = await run("git", ["status", "--porcelain"], { capture: true });
  const dirty = status.stdout.trim().length > 0;

  assert(!dirty, "Preflight failed: git working tree must be clean before deploy.");
  if (target.requireMainBranch) {
    assert(branch === "main", `Preflight failed: target ${targetName} requires current branch 'main'.`);
  }

  const configText = await readFile(target.configPath, "utf8");
  assert(!configText.includes("REPLACE_WITH_"), "Preflight failed: unresolved placeholders in Wrangler config.");

  const name = parseTomlValue(configText, "name");
  const databaseName = parseTomlValue(configText, "database_name");
  const bucketName = parseTomlValue(configText, "bucket_name");
  assert(name === target.expected.name, `Preflight failed: config name '${name}' != '${target.expected.name}'.`);
  assert(
    databaseName === target.expected.databaseName,
    `Preflight failed: database_name '${databaseName}' != '${target.expected.databaseName}'.`,
  );
  assert(
    bucketName === target.expected.bucketName,
    `Preflight failed: bucket_name '${bucketName}' != '${target.expected.bucketName}'.`,
  );

  if (targetName === "prod-main") {
    await run("node", ["scripts/validate-prod-release.mjs"]);
  }

  return { branch, commit };
}

async function writeReleaseManifest(targetName, project, branch, commit) {
  const manifest = {
    app: "LinkSim",
    deployedAtIso: new Date().toISOString(),
    target: targetName,
    project,
    branch,
    commit,
  };
  await writeFile(releaseManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function withWranglerConfig(configPath, fn) {
  if (configPath === wranglerProd) return fn();
  await copyFile(wranglerProd, wranglerBackup);
  await copyFile(configPath, wranglerProd);
  try {
    return await fn();
  } finally {
    await rename(wranglerBackup, wranglerProd).catch(() => {});
  }
}

async function verifyDeployment(projectName, commit) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const { stdout } = await run(
      "npx",
      ["wrangler", "pages", "deployment", "list", "--project-name", projectName],
      { capture: true },
    );
    const lines = stdout.split("\n");
    const tableRows = lines.filter((line) => line.includes("│") && line.includes("http"));
    const top = tableRows[0] ?? "";
    if (top.includes(commit)) {
      return;
    }
    await sleep(5000);
  }
  throw new Error(`Post-deploy verification failed: latest deployment for ${projectName} did not show commit ${commit}.`);
}

async function main() {
  const targetName = parseArg("target");
  const target = TARGETS[targetName];
  if (!target) {
    throw new Error(
      `Missing/invalid --target. Allowed: ${Object.keys(TARGETS)
        .map((key) => `'${key}'`)
        .join(", ")}`,
    );
  }

  const { branch: currentBranch, commit } = await preflight(targetName, target);
  const deployBranch = target.branch === "CURRENT" ? currentBranch : target.branch;

  await writeReleaseManifest(targetName, target.projectName, deployBranch, commit);

  await withWranglerConfig(target.configPath, async () => {
    await run("npx", [
      "wrangler",
      "pages",
      "deploy",
      "dist",
      "--project-name",
      target.projectName,
      "--branch",
      deployBranch,
    ]);
  });

  await verifyDeployment(target.projectName, commit);
  console.log(
    `[deploy-pages-safe] Success: target=${targetName} project=${target.projectName} branch=${deployBranch} commit=${commit}`,
  );
}

main().catch((error) => {
  console.error(`[deploy-pages-safe] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
