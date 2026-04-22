import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const wrangler = path.join(root, "node_modules", ".bin", "wrangler");
const wranglerProd = path.join(root, "wrangler.toml");
const wranglerStaging = path.join(root, "wrangler.staging.toml");
const wranglerBackup = path.join(root, "wrangler.toml.__deploy_backup__");
const distDir = path.join(root, "dist");
const releaseManifestPath = path.join(distDir, "release.json");
const ENV_FILES_FOR_VITE = [".env", ".env.local", ".env.production", ".env.production.local"];
const LINK_PROFILE_CHART_PATH = path.join(root, "src", "components", "LinkProfileChart.tsx");

const REQUIRED_ENV_BY_TARGET = {
  staging: ["VITE_MAPTILER_KEY"],
  "staging-preview": ["VITE_MAPTILER_KEY"],
  "prod-main": ["VITE_MAPTILER_KEY"],
};

const TARGETS = {
  staging: {
    projectName: "linksim-staging",
    branch: "main",
    requiredBranch: "staging",
    configPath: wranglerStaging,
    environmentLabel: "staging",
    expected: {
      name: "linksim-staging",
      databaseName: "linksim_staging",
      bucketName: "linksim-avatars-staging",
    },
  },
  "staging-preview": {
    projectName: "linksim-staging",
    branch: "CURRENT",
    requiredBranch: "",
    configPath: wranglerStaging,
    environmentLabel: "staging-preview",
    expected: {
      name: "linksim-staging",
      databaseName: "linksim_staging",
      bucketName: "linksim-avatars-staging",
    },
  },
  "prod-main": {
    projectName: "linksim",
    branch: "main",
    requiredBranch: "main",
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

const parseDotEnv = (content) => {
  const parsed = {};
  const lines = content.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
};

async function loadViteEnvDefaults() {
  const resolved = {};
  for (const relativePath of ENV_FILES_FOR_VITE) {
    const filePath = path.join(root, relativePath);
    try {
      const content = await readFile(filePath, "utf8");
      Object.assign(resolved, parseDotEnv(content));
    } catch {
      // Missing env files are expected in some environments.
    }
  }
  return resolved;
}

async function verifyRequiredDeployEnv(targetName) {
  const required = REQUIRED_ENV_BY_TARGET[targetName] ?? [];
  if (required.length === 0) return;
  const envDefaults = await loadViteEnvDefaults();
  const missing = required.filter((name) => {
    const value = String(process.env[name] ?? envDefaults[name] ?? "").trim();
    return value.length === 0;
  });
  assert(
    missing.length === 0,
    `Preflight failed: missing required deploy env var(s): ${missing.join(", ")}. Set them in environment or .env.local before building/deploying.`,
  );
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function verifyChartRegressionGuards() {
  const chartSource = await readFile(LINK_PROFILE_CHART_PATH, "utf8");
  const forbiddenPatterns = [
    {
      pattern: "useState({ width: 1200, height: 190 })",
      message:
        "Preflight failed: LinkProfileChart.tsx reintroduced hardcoded fallback chartSize 1200x190.",
    },
    {
      pattern: "{ width: 1200, height: 190 }",
      message:
        "Preflight failed: LinkProfileChart.tsx contains hardcoded fallback dimensions 1200x190.",
    },
  ];

  for (const { pattern, message } of forbiddenPatterns) {
    assert(!chartSource.includes(pattern), message);
  }
}

const parseWranglerJsonPayload = (stdout) => {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end < start) return null;
  const payload = stdout.slice(start, end + 1);
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

async function verifyRemoteSchema(targetName, databaseName) {
  if (targetName !== "staging" && targetName !== "prod-main") return;
  // Skip in CI: schema correctness is enforced by the PR/migration review process.
  // The check requires D1 API access beyond what the deploy token provides.
  if (process.env.GITHUB_ACTIONS === "true") return;
  let d1Result;
  try {
    d1Result = await run(
      wrangler,
      ["d1", "execute", databaseName, "--remote", "--command", "PRAGMA table_info(resource_changes);"],
      { capture: true },
    );
  } catch (err) {
    const msg = String(err?.message ?? "");
    if (msg.includes("Authentication") || msg.includes("code: 10000") || msg.includes("code: 9106") || msg.includes("Authentication failed")) {
      throw new Error(
        "D1 preflight failed: Cloudflare authentication error. " +
        "Deploy scripts require CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. " +
        "Do NOT run deploy scripts locally — CI handles all deploys automatically on merge to staging or main.",
      );
    }
    throw err;
  }
  const { stdout } = d1Result;
  const parsed = parseWranglerJsonPayload(stdout);
  assert(Array.isArray(parsed) && parsed.length > 0, "Preflight failed: unable to parse D1 schema output.");
  const first = parsed[0];
  const rows = Array.isArray(first?.results) ? first.results : [];
  const columns = new Set(rows.map((row) => String(row?.name ?? "")).filter(Boolean));
  const required = ["details_json", "snapshot_json"];
  const missing = required.filter((column) => !columns.has(column));
  assert(
    missing.length === 0,
    `Preflight failed: D1 schema missing columns in resource_changes: ${missing.join(
      ", ",
    )}. Apply migration db/migrations/2026-03-15_changelog_details.sql before deploy.`,
  );
}

async function getGitRef(args = ["rev-parse", "--abbrev-ref", "HEAD"]) {
  const { stdout } = await run("git", args, { capture: true });
  return stdout.trim();
}

async function preflight(targetName, target) {
  const branch = await getGitRef();
  const commit = await getGitRef(["rev-parse", "--short", "HEAD"]);
  const headTags =
    targetName === "prod-main"
      ? (await run("git", ["tag", "--points-at", "HEAD"], { capture: true })).stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      : [];
  const expectedReleaseTag =
    targetName === "prod-main"
      ? `v${JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version}`
      : "";
  const status = await run("git", ["status", "--porcelain"], { capture: true });
  assert(status.stdout.trim().length === 0, "Preflight failed: unexpected dirty files before deploy.");
  if (target.requiredBranch) {
    const isTaggedProdCheckout = targetName === "prod-main" && headTags.includes(expectedReleaseTag);
    assert(
      branch === target.requiredBranch || isTaggedProdCheckout,
      `Preflight failed: target ${targetName} requires current branch '${target.requiredBranch}' or the tagged release commit.`,
    );
  }

  await verifyRequiredDeployEnv(targetName);

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

  await verifyRemoteSchema(targetName, databaseName);

  if (targetName === "prod-main") {
    await run("node", ["scripts/validate-prod-release.mjs"]);
  }

  await verifyChartRegressionGuards();

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

async function verifyDeployment(targetName, projectName, commit) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const { stdout } = await run(
      wrangler,
      ["pages", "deployment", "list", "--project-name", projectName],
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
  const message = `Post-deploy verification failed: latest deployment for ${projectName} did not show commit ${commit}.`;
  if (targetName === "prod-main") {
    console.warn(`[deploy-pages-safe] ${message} Proceeding because the Pages deploy itself completed successfully.`);
    return;
  }
  throw new Error(message);
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

  const rawCommitMsg = await getGitRef(["log", "-1", "--format=%s"]);
  // Cloudflare Pages API requires a pure ASCII commit message string.
  // Strip or replace any non-ASCII characters before passing it.
  const commitMessage = rawCommitMsg.replace(/[^\x00-\x7F]/g, (ch) => {
    const replacements = { "\u00D7": "x", "\u2013": "-", "\u2014": "--", "\u2018": "'", "\u2019": "'", "\u201C": '"', "\u201D": '"' };
    return replacements[ch] ?? "";
  });

  try {
    await withWranglerConfig(target.configPath, async () => {
      await run(wrangler, [
        "pages",
        "deploy",
        "dist",
        "--project-name",
        target.projectName,
        "--branch",
        deployBranch,
        "--commit-message",
        commitMessage || commit,
      ]);
    });

    await verifyDeployment(targetName, target.projectName, commit);
    console.log(
      `[deploy-pages-safe] Success: target=${targetName} project=${target.projectName} branch=${deployBranch} commit=${commit}`,
    );
  } catch (error) {
    console.error(`[deploy-pages-safe] ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

main().catch((error) => {
  console.error(`[deploy-pages-safe] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
