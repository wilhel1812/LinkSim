#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// New tables must be classified explicitly before any refresh can proceed.
export const applicationTables = [
  'users', 'deleted_users', 'verified_identity_claims', 'identity_subject_states',
  'identity_lifecycle_meta', 'sites', 'site_roles', 'simulations', 'simulation_roles',
  'resource_changes', 'simulation_path_leaderboard_entries', 'user_identity_audit',
  'site_notice', 'site_notice_audit',
];
export const excludedTables = [
  '_cf_KV', 'd1_migrations', 'sqlite_sequence',
  'auth_user', 'auth_account', 'auth_session', 'auth_verification', 'auth_passkey',
  'auth_rate_limit', 'auth_identity_map', 'auth_migration_attempt',
];
export function selectExportTables(names) {
  for (const name of names) {
    if (!applicationTables.includes(name) && !excludedTables.includes(name)) {
      throw new Error(`Unclassified table: ${name}`);
    }
  }
  return applicationTables.filter(name => names.includes(name));
}
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const literal = value => {
  if (value === null) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
};
export function sanitizeExport(sql) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(sql);
    const schema = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    const names = schema.map(row => row.name);
    const tables = selectExportTables(names);
    if (tables.length !== names.length) throw new Error('Excluded table present in application export');
    if (!tables.includes('users')) throw new Error('User schema missing');
    // No production display names, contact fields or avatar references are imported.
    db.exec(`UPDATE users SET username = 'staging-user-' || rowid,
      email = 'staging+user-' || rowid || '@example.invalid', bio = '', access_request_note = '',
      idp_email = 'staging+user-' || rowid || '@example.invalid', avatar_url = NULL,
      avatar_object_key = NULL, avatar_thumb_key = NULL, avatar_hash = NULL,
      avatar_bytes = NULL, avatar_content_type = NULL;`);
    const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(row => row.name));
    for (const column of ['basemap_preferences_json', 'simulation_defaults_preference_json', 'default_frequency_preset_id']) {
      if (userColumns.has(column)) db.exec(`UPDATE users SET ${identifier(column)} = NULL`);
    }
    if (tables.includes('verified_identity_claims') !== tables.includes('identity_subject_states')) {
      throw new Error('Incomplete legacy identity schema');
    }
    if (tables.includes('verified_identity_claims')) db.exec(readFileSync(new URL('../db/staging-anonymize-identity.sql', import.meta.url), 'utf8'));
    for (const table of ['user_identity_audit', 'site_notice_audit', 'site_notice']) {
      if (tables.includes(table)) db.exec(`DELETE FROM ${identifier(table)}`);
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Invalid export relationships');
    const output = ['PRAGMA defer_foreign_keys = ON;'];
    for (const name of tables) {
      output.push(schema.find(row => row.name === name).sql.replace(/^CREATE TABLE(?: IF NOT EXISTS)?/i, 'CREATE TABLE IF NOT EXISTS') + ';');
    }
    for (const name of [...tables].reverse()) output.push(`DELETE FROM ${identifier(name)};`);
    for (const name of tables) {
      const columns = db.prepare(`PRAGMA table_info(${identifier(name)})`).all().map(row => row.name);
      const select = db.prepare(`SELECT * FROM ${identifier(name)}`);
      select.setReadBigInts(true);
      for (const row of select.iterate()) output.push(`INSERT INTO ${identifier(name)} (${columns.map(identifier).join(',')}) VALUES (${columns.map(column => literal(row[column])).join(',')});`);
    }
    for (const row of db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all()) {
      output.push(row.sql.replace(/^CREATE (UNIQUE )?INDEX(?: IF NOT EXISTS)?/i, 'CREATE $1INDEX IF NOT EXISTS') + ';');
    }
    return output.join('\n') + '\n';
  } finally { db.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, input, output] = process.argv.slice(2);
  if (mode === 'tables') {
    const responses = JSON.parse(readFileSync(input, 'utf8'));
    if (!Array.isArray(responses) || responses.some(r => !r.success || !Array.isArray(r.results))) throw new Error('Invalid table inventory');
    const names = responses.flatMap(r => r.results.map(row => row.name));
    const tables = selectExportTables(names);
    if (!tables.includes('users')) throw new Error('User schema missing');
    if (names.some(name => name.startsWith('auth_'))) {
      // Until an explicit staging-auth reset workflow exists, fail closed on refresh.
      if (output === 'target') throw new Error('Staging auth tables exist; explicit credential reset workflow required');
    }
    process.stdout.write(tables.join('\n') + '\n');
  } else if (mode === 'sanitize' && output) {
    writeFileSync(output, sanitizeExport(readFileSync(input, 'utf8')), { mode: 0o600, flag: 'wx' });
  } else throw new Error('Usage: staging-export.mjs tables inventory.json [target] | sanitize input.sql output.sql');
}
