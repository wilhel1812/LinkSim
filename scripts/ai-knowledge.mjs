#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentRegistry } from "./ai-provenance.mjs";

const DEFAULT_KNOWLEDGE_PATH = resolve(process.cwd(), "config/ai-agent-knowledge.json");
const DEFAULT_AGENT_PATH = resolve(process.cwd(), "config/ai-agents.json");
const ENTRY_FIELDS = ["affectedAgents", "evidence", "humanApproval", "id", "lesson", "status"];

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireExactFields(value, fields, label) {
  const actual = Object.keys(requireObject(value, label)).sort();
  const expected = [...fields].sort();
  const unsupported = actual.filter((field) => !expected.includes(field));
  const missing = expected.filter((field) => !actual.includes(field));
  if (unsupported.length > 0) {
    throw new Error(`${label} contains unsupported field: ${unsupported[0]}`);
  }
  if (missing.length > 0) {
    throw new Error(`${label} is missing field: ${missing[0]}`);
  }
}

function requireShortString(value, label, maximum = 280) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value.length > maximum || /[\r\n]/.test(value)) {
    throw new Error(`${label} must be one short line`);
  }
  return value;
}

function requireUniqueStrings(value, label, maximum = 280) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  const strings = value.map((item) => requireShortString(item, label, maximum));
  if (new Set(strings).size !== strings.length) {
    throw new Error(`${label} contains duplicate values`);
  }
  return strings;
}

export function validateKnowledgeRegistry(registry, agentRegistry = loadAgentRegistry(DEFAULT_AGENT_PATH)) {
  requireExactFields(registry, ["schemaVersion", "maxLoadedCharacters", "entries"], "knowledge registry");
  if (registry.schemaVersion !== 1) {
    throw new Error("unsupported knowledge registry schema version");
  }
  if (!Number.isInteger(registry.maxLoadedCharacters) || registry.maxLoadedCharacters < 256 || registry.maxLoadedCharacters > 4000) {
    throw new Error("knowledge load cap must be an integer from 256 to 4000 characters");
  }
  if (!Array.isArray(registry.entries) || registry.entries.length === 0) {
    throw new Error("knowledge registry must define entries");
  }

  const knownAgents = new Set(agentRegistry.agents.map((agent) => agent.name));
  const ids = new Set();
  for (const entry of registry.entries) {
    requireExactFields(entry, ENTRY_FIELDS, "knowledge entry");
    const id = requireShortString(entry.id, "knowledge entry id", 80);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error(`invalid knowledge entry id: ${id}`);
    }
    if (ids.has(id)) {
      throw new Error(`duplicate knowledge entry id: ${id}`);
    }
    ids.add(id);
    requireShortString(entry.lesson, `${id} lesson`);
    const affectedAgents = requireUniqueStrings(entry.affectedAgents, `${id} affected agents`, 40);
    for (const agent of affectedAgents) {
      if (!knownAgents.has(agent)) {
        throw new Error(`${id} references unknown agent: ${agent}`);
      }
    }
    if (entry.evidence.length > 5) {
      throw new Error(`${id} evidence exceeds five items`);
    }
    requireUniqueStrings(entry.evidence, `${id} evidence`, 240);
    requireExactFields(entry.humanApproval, ["approvedAt", "by", "source"], `${id} human approval`);
    requireShortString(entry.humanApproval.by, `${id} human approval by`, 80);
    requireShortString(entry.humanApproval.source, `${id} human approval source`, 160);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.humanApproval.approvedAt))) {
      throw new Error(`${id} human approval date must use YYYY-MM-DD`);
    }
    if (!new Set(["approved", "retired"]).has(entry.status)) {
      throw new Error(`${id} status must be approved or retired`);
    }
  }
  return registry;
}

export function loadKnowledgeRegistry(knowledgePath = DEFAULT_KNOWLEDGE_PATH, agentPath = DEFAULT_AGENT_PATH) {
  return validateKnowledgeRegistry(JSON.parse(readFileSync(knowledgePath, "utf8")), loadAgentRegistry(agentPath));
}

export function selectKnowledgeForAgent(registry, agentName) {
  const agentRegistry = loadAgentRegistry(DEFAULT_AGENT_PATH);
  const validated = validateKnowledgeRegistry(registry, agentRegistry);
  if (!agentRegistry.agents.some((agent) => agent.name === agentName)) {
    throw new Error(`unknown agent: ${agentName}`);
  }
  const entries = [];
  let truncated = false;
  for (const entry of validated.entries) {
    if (entry.status !== "approved" || !entry.affectedAgents.includes(agentName)) {
      continue;
    }
    const publicEntry = { id: entry.id, lesson: entry.lesson, evidence: entry.evidence };
    const candidate = [...entries, publicEntry];
    if (JSON.stringify(candidate).length > validated.maxLoadedCharacters) {
      truncated = true;
      break;
    }
    entries.push(publicEntry);
  }
  return {
    agent: agentName,
    maxCharacters: validated.maxLoadedCharacters,
    characters: JSON.stringify(entries).length,
    truncated,
    entries,
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
  const registry = loadKnowledgeRegistry(options.registry ?? DEFAULT_KNOWLEDGE_PATH, options.agents ?? DEFAULT_AGENT_PATH);
  if (command === "validate") {
    process.stdout.write("AI role knowledge registry valid.\n");
    return;
  }
  if (command === "for-agent") {
    const agent = requireShortString(options.agent, "agent", 40);
    process.stdout.write(`${JSON.stringify(selectKnowledgeForAgent(registry, agent))}\n`);
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
