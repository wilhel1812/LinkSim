#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectExportTables } from './staging-table-inventory.mjs';
export { applicationTables, excludedTables, selectExportTables } from './staging-table-inventory.mjs';

export function selectRefreshTables(source, target) {
  const tables = selectExportTables(source);
  const targetTables = selectExportTables(target);
  if (!tables.includes('users') || !targetTables.includes('users')) throw new Error('User schema missing');
  if (tables.join(',') !== targetTables.join(',')) throw new Error('Application schema mismatch; align staging and production schemas before refresh');
  return tables;
}
const readInventory = path => {
  const responses = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(responses) || responses.some(r => !r.success || !Array.isArray(r.results))) throw new Error('Invalid table inventory');
  return responses.flatMap(r => r.results.map(row => row.name));
};
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const literal = value => {
  if (value === null) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
};
export function sanitizeExport(sql, archiveCopies = []) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(sql);
    const schema = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    const names = schema.map(row => row.name);
    const tables = selectExportTables(names);
    if (tables.length !== names.length) throw new Error('Excluded table present in application export');
    if (!tables.includes('users')) throw new Error('User schema missing');
    if (tables.includes('resource_changes')) {
      const historyColumns = new Set(db.prepare('PRAGMA table_info(resource_changes)').all().map(row => row.name));
      const hasKey = historyColumns.has('archive_key');
      const hasDigest = historyColumns.has('archive_digest');
      if (hasKey !== hasDigest) throw new Error('Incomplete archive schema in staging export');
      const archived = hasKey
        ? db.prepare('SELECT id, archive_key, archive_digest FROM resource_changes WHERE archive_key IS NOT NULL OR archive_digest IS NOT NULL').all()
        : [];
      if (!Array.isArray(archiveCopies) || archived.length !== archiveCopies.length) {
        throw new Error('Archived history cannot be imported into staging without complete verified copies');
      }
      const copies = new Map();
      for (const copy of archiveCopies) {
        if (!copy || !Number.isSafeInteger(copy.id) || copy.id < 1 || copies.has(copy.id)) {
          throw new Error('Invalid or duplicate staging archive copy');
        }
        copies.set(copy.id, copy);
      }
      for (const row of archived) {
        const copy = copies.get(row.id);
        if (!copy || copy.sourceKey !== row.archive_key || copy.sourceDigest !== row.archive_digest ||
            !new RegExp(`^history-prototype/production/${row.id}/[0-9a-f-]{36}$`).test(row.archive_key ?? '') ||
            copy.stagingKey !== `history-prototype/staging/${row.id}/${copy.stagingDigest}` ||
            !/^[0-9a-f]{64}$/.test(row.archive_digest ?? '') || !/^[0-9a-f]{64}$/.test(copy.stagingDigest ?? '')) {
          throw new Error('Archived history cannot be imported into staging without matching verified copies');
        }
        const changed = db.prepare('UPDATE resource_changes SET archive_key=?, archive_digest=? WHERE id=? AND archive_key=? AND archive_digest=?')
          .run(copy.stagingKey, copy.stagingDigest, row.id, row.archive_key, row.archive_digest).changes;
        if (changed !== 1) throw new Error('Staging archive reference changed during export');
      }
    } else if (archiveCopies.length) {
      throw new Error('Unexpected staging archive copies without history table');
    }
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
  if (mode === 'tables' && output) {
    const tables = selectRefreshTables(readInventory(input), readInventory(output));
    process.stdout.write(tables.join('\n') + '\n');
  } else if (mode === 'sanitize' && output) {
    writeFileSync(output, sanitizeExport(readFileSync(input, 'utf8')), { mode: 0o600, flag: 'wx' });
  } else if (mode === 'sanitize-with-archives' && output) {
    const sql = readFileSync(input, 'utf8');
    const { copyArchivedRowsWithR2 } = await import('./staging-history-transfer.mjs');
    const copies = await copyArchivedRowsWithR2(sql);
    writeFileSync(output, sanitizeExport(sql, copies), { mode: 0o600, flag: 'wx' });
  } else throw new Error('Usage: staging-export.mjs tables source.json target.json | sanitize input.sql output.sql | sanitize-with-archives input.sql output.sql');
}
