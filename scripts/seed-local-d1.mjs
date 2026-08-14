import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

export const LOCAL_D1_DATABASE = "linksim";
export const LOCAL_D1_SEED_FILE = "db/local-seeds/test-users.sql";
export const LOCAL_WRANGLER_COMMAND = resolve(
  REPOSITORY_ROOT,
  "node_modules/.bin/wrangler",
);

export const buildLocalD1SeedArgs = () => [
  "d1",
  "execute",
  LOCAL_D1_DATABASE,
  "--local",
  "--file",
  resolve(REPOSITORY_ROOT, LOCAL_D1_SEED_FILE),
  "--yes",
];

const isCiEnvironment = (env) => {
  const ci = String(env.CI ?? "").trim().toLowerCase();
  return (
    (ci !== "" && ci !== "false" && ci !== "0") ||
    String(env.GITHUB_ACTIONS ?? "").trim().toLowerCase() === "true"
  );
};

export const runLocalD1Seed = ({
  args = process.argv.slice(2),
  env = process.env,
  runner = spawnSync,
} = {}) => {
  if (args.length > 0) {
    throw new Error(
      "Local D1 seed does not accept arguments, database targets, environments, or remote flags.",
    );
  }
  if (isCiEnvironment(env)) {
    throw new Error("Local D1 seed is disabled in CI.");
  }

  const result = runner(LOCAL_WRANGLER_COMMAND, buildLocalD1SeedArgs(), {
    cwd: REPOSITORY_ROOT,
    env,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    throw new Error("Local D1 seed failed; the local database was not confirmed seeded.");
  }
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    runLocalD1Seed();
    console.log("Local D1 test users seeded.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
