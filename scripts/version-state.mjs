#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASE_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const parseBaseVersion = (value, label = "version") => {
  const normalized = String(value ?? "").trim();
  const match = normalized.match(BASE_SEMVER_PATTERN);
  if (!match) {
    throw new Error(`${label} must be a valid base SemVer (MAJOR.MINOR.PATCH): ${normalized || "(missing)"}.`);
  }
  return {
    value: normalized,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

export const compareBaseVersions = (left, right) => {
  const a = parseBaseVersion(left, "version");
  const b = parseBaseVersion(right, "comparison version");
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
};

export const parsePackageVersionInputs = (packageContent, lockfileContent) => {
  const packageJson = JSON.parse(packageContent);
  const packageLock = JSON.parse(lockfileContent);
  return {
    packageVersion: packageJson.version,
    lockfileVersion: packageLock.version,
    lockfileRootVersion: packageLock.packages?.[""]?.version,
  };
};

export const validatePackageVersionParity = ({
  packageVersion,
  lockfileVersion,
  lockfileRootVersion,
  label = "package",
}) => {
  const declared = parseBaseVersion(packageVersion, `${label} package.json version`);
  const lockfile = parseBaseVersion(
    lockfileVersion,
    `${label} package-lock.json version`,
  );
  const lockfileRoot = parseBaseVersion(
    lockfileRootVersion,
    `${label} package-lock.json root package version`,
  );
  if (lockfile.value !== declared.value || lockfileRoot.value !== declared.value) {
    throw new Error(
      `${label} package-lock.json versions must match package.json ` +
        `(${declared.value}); found ${lockfile.value} and ${lockfileRoot.value}.`,
    );
  }
  return declared.value;
};

export const validateStagingVersionState = ({
  productionVersion,
  stagingVersion,
  treesMatch,
}) => {
  const production = parseBaseVersion(productionVersion, "production version");
  const staging = parseBaseVersion(stagingVersion, "staging version");

  if (treesMatch) {
    if (staging.value !== production.value) {
      throw new Error(
        `Staging and production trees match but declare different versions (${staging.value} and ${production.value}).`,
      );
    }
    return "same-release-tree";
  }

  if (staging.value === production.value) {
    throw new Error(
      `Staging diverged from production without selecting the next development version after ${production.value}.`,
    );
  }

  const isNextPatch =
    staging.major === production.major &&
    staging.minor === production.minor &&
    staging.patch === production.patch + 1;
  const isNextMinor =
    staging.major === production.major &&
    staging.minor === production.minor + 1 &&
    staging.patch === 0;

  if (!isNextPatch && !isNextMinor) {
    throw new Error(
      `Staging version ${staging.value} must explicitly select either next patch ` +
        `${production.major}.${production.minor}.${production.patch + 1} or next minor ` +
        `${production.major}.${production.minor + 1}.0.`,
    );
  }

  return {
    state: "development-line",
    progression: isNextPatch ? "next-patch" : "next-minor",
  };
};

const runGit = (args, options = {}) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: options.allowDifference ? ["ignore", "ignore", "pipe"] : ["ignore", "pipe", "pipe"],
  });

export const validateCurrentStagingVersionState = ({ productionRef = "origin/main" } = {}) => {
  const stagingVersion = validatePackageVersionParity({
    ...parsePackageVersionInputs(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
    ),
    label: "staging",
  });
  const productionVersion = validatePackageVersionParity({
    ...parsePackageVersionInputs(
      runGit(["show", `${productionRef}:package.json`]),
      runGit(["show", `${productionRef}:package-lock.json`]),
    ),
    label: "production",
  });

  let treesMatch = true;
  try {
    runGit(["diff", "--quiet", "HEAD", productionRef, "--"], {
      allowDifference: true,
    });
  } catch (error) {
    if (error?.status === 1) treesMatch = false;
    else throw error;
  }

  return {
    productionVersion,
    stagingVersion,
    result: validateStagingVersionState({
      productionVersion,
      stagingVersion,
      treesMatch,
    }),
  };
};

const parseArg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
};

const main = () => {
  const command = process.argv[2];
  if (command !== "staging") {
    throw new Error("Usage: node scripts/version-state.mjs staging [--production-ref origin/main]");
  }
  const result = validateCurrentStagingVersionState({
    productionRef: parseArg("production-ref") || "origin/main",
  });
  console.log(
    `[version-state] ok production=${result.productionVersion} staging=${result.stagingVersion} ` +
      `state=${typeof result.result === "string" ? result.result : result.result.progression}`,
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`[version-state] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
