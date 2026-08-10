#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REGISTRY_PATH = resolve(process.cwd(), "config/ai-agents.json");
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireUniqueStrings(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  const normalized = value.map((item) => requireNonEmptyString(item, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contains duplicate values`);
  }
  return normalized;
}

export function validateAgentRegistry(registry) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    throw new Error("agent registry must be an object");
  }
  if (registry.schemaVersion !== 1) {
    throw new Error("unsupported agent registry schema version");
  }
  if (registry.markerPrefix !== "linksim-ai:v1") {
    throw new Error("unsupported provenance marker prefix");
  }
  if (!Array.isArray(registry.agents) || registry.agents.length === 0) {
    throw new Error("agent registry must define agents");
  }

  const names = new Set();
  const signatures = new Set();
  for (const agent of registry.agents) {
    const name = requireNonEmptyString(agent?.name, "agent name");
    const role = requireNonEmptyString(agent?.role, `${name} role`);
    const signature = requireNonEmptyString(agent?.signature, `${name} signature`);
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
      throw new Error(`invalid agent name: ${name}`);
    }
    if (names.has(name)) {
      throw new Error(`duplicate agent name: ${name}`);
    }
    if (signatures.has(signature)) {
      throw new Error(`duplicate agent signature: ${signature}`);
    }
    if (!signature.includes(name) || !signature.includes("AI ")) {
      throw new Error(`${name} signature is not visibly bot-attributed`);
    }
    if (typeof agent.githubIdentity !== "object" || !agent.githubIdentity) {
      throw new Error(`${name} GitHub identity is missing`);
    }
    requireNonEmptyString(agent.githubIdentity.kind, `${name} GitHub identity kind`);
    const allowed = requireUniqueStrings(agent.allowedActions, `${name} allowed actions`);
    const prohibited = requireUniqueStrings(
      agent.prohibitedActions,
      `${name} prohibited actions`,
    );
    const overlap = allowed.find((action) => prohibited.includes(action));
    if (overlap) {
      throw new Error(`${name} action is both allowed and prohibited: ${overlap}`);
    }
    requireNonEmptyString(role, `${name} role`);
    names.add(name);
    signatures.add(signature);
  }

  for (const agent of registry.agents) {
    if (
      agent.githubIdentity.kind === "relayed-by" &&
      !names.has(agent.githubIdentity.agent)
    ) {
      throw new Error(`${agent.name} references unknown relay agent`);
    }
  }
  return registry;
}

export function loadAgentRegistry(path = DEFAULT_REGISTRY_PATH) {
  return validateAgentRegistry(JSON.parse(readFileSync(path, "utf8")));
}

export function getAgent(registry, name) {
  validateAgentRegistry(registry);
  const agent = registry.agents.find((candidate) => candidate.name === name);
  if (!agent) {
    throw new Error(`unknown agent: ${name}`);
  }
  return agent;
}

function validateArtifactFields(registry, fields) {
  const agent = getAgent(registry, fields.agent);
  if (!RUN_ID_PATTERN.test(String(fields.run ?? ""))) {
    throw new Error("invalid provenance run ID");
  }
  if (!SOURCE_PATTERN.test(String(fields.source ?? ""))) {
    throw new Error("invalid provenance source");
  }
  if (!COMMIT_PATTERN.test(String(fields.commit ?? ""))) {
    throw new Error("invalid provenance commit SHA");
  }
  return {
    agent,
    run: String(fields.run).toLowerCase(),
    source: String(fields.source),
    commit: String(fields.commit).toLowerCase(),
  };
}

export function formatProvenanceMarker(registry, fields) {
  const valid = validateArtifactFields(registry, fields);
  return `<!-- ${registry.markerPrefix} agent=${valid.agent.name} bot=true run=${valid.run} source=${valid.source} commit=${valid.commit} -->`;
}

export function formatArtifactFooter(registry, fields) {
  const agent = getAgent(registry, fields.agent);
  return {
    signature: agent.signature,
    marker: formatProvenanceMarker(registry, fields),
  };
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateSignedArtifact(registry, artifact, options = {}) {
  validateAgentRegistry(registry);
  if (typeof artifact !== "string" || artifact.trim() === "") {
    throw new Error("artifact must be non-empty text");
  }
  const markerStart = `<!-- ${registry.markerPrefix} `;
  const markerCount = artifact.split(markerStart).length - 1;
  if (markerCount !== 1) {
    throw new Error("artifact must contain exactly one provenance marker");
  }
  const markerPattern = new RegExp(
    `<!-- ${escapePattern(registry.markerPrefix)} agent=([A-Za-z][A-Za-z0-9_-]*) bot=true run=([^ ]+) source=([^ ]+) commit=([0-9a-fA-F]+) -->`,
    "g",
  );
  const matches = [...artifact.matchAll(markerPattern)];
  if (matches.length !== 1) {
    throw new Error("artifact must contain exactly one valid provenance marker");
  }
  const [, agentName, run, source, commit] = matches[0];
  const valid = validateArtifactFields(registry, {
    agent: agentName,
    run,
    source,
    commit,
  });
  if (options.expectedAgent && valid.agent.name !== options.expectedAgent) {
    throw new Error(`artifact names ${valid.agent.name}, expected ${options.expectedAgent}`);
  }
  const signaturePattern = new RegExp(
    `(?:^|\\n)${escapePattern(valid.agent.signature)}(?:$|\\n)`,
  );
  if (!signaturePattern.test(artifact)) {
    throw new Error(`artifact is missing ${valid.agent.name}'s visible signature`);
  }
  return {
    agent: valid.agent.name,
    run: valid.run,
    source: valid.source,
    commit: valid.commit,
  };
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`invalid CLI option: ${key ?? ""}`);
    }
    options[key.slice(2)] = value;
  }
  return options;
}

function runCli(args) {
  const [command, ...rest] = args;
  const options = parseOptions(rest);
  const registry = loadAgentRegistry(options.registry ?? DEFAULT_REGISTRY_PATH);
  if (command === "validate-registry") {
    process.stdout.write("Agent registry valid.\n");
    return;
  }
  if (command === "footer") {
    process.stdout.write(
      `${JSON.stringify(
        formatArtifactFooter(registry, {
          agent: options.agent,
          run: options.run,
          source: options.source,
          commit: options.commit,
        }),
      )}\n`,
    );
    return;
  }
  if (command === "validate-artifact") {
    const artifactPath = requireNonEmptyString(options.file, "artifact file");
    validateSignedArtifact(registry, readFileSync(artifactPath, "utf8"), {
      expectedAgent: options.agent,
    });
    process.stdout.write("AI artifact provenance valid.\n");
    return;
  }
  throw new Error(`unknown command: ${command ?? ""}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
