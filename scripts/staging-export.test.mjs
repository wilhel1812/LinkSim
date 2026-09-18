import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { selectExportTables, selectRefreshTables, sanitizeExport } from './staging-export.mjs';
const schema = readFileSync('db/schema.sql', 'utf8');
const archiveMigration = readFileSync('db/migrations/2026-09-18_history_archive.sql', 'utf8');
describe('staging export boundary', () => {
  it('runs the archive-aware CLI for inline exports without R2 credentials', () => {
    const directory = mkdtempSync(join(tmpdir(), 'linksim-staging-cli-'));
    try {
      const input = join(directory, 'source.sql');
      const output = join(directory, 'sanitized.sql');
      writeFileSync(input, schema + "\nINSERT INTO users (id,username,created_at) VALUES ('u1','private-name','2026-01-01');");
      const result = spawnSync(process.execPath, ['scripts/staging-export.mjs', 'sanitize-with-archives', input, output],
        { cwd: process.cwd(), timeout: 5000, encoding: 'utf8', env: { ...process.env,
          R2_HISTORY_SOURCE_ACCESS_KEY_ID: '', R2_HISTORY_SOURCE_SECRET_ACCESS_KEY: '',
          R2_HISTORY_STAGING_ACCESS_KEY_ID: '', R2_HISTORY_STAGING_SECRET_ACCESS_KEY: '' } });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(output, 'utf8')).toContain('staging-user-1');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('keeps archived staging rows replaceable by an inline production refresh after the archive migration', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(schema);
      db.exec(archiveMigration);
      const columns = db.prepare('PRAGMA table_info(resource_changes)').all().map(row => row.name);
      expect(columns).toEqual(expect.arrayContaining(['archive_key', 'archive_digest']));
      db.exec(`INSERT INTO users (id, username, created_at) VALUES ('u1', 'staging-name', '2026-01-01');
INSERT INTO resource_changes (resource_kind, resource_id, action, actor_user_id, changed_at,
  snapshot_json, archive_key, archive_digest) VALUES
  ('simulation', 'sim-1', 'updated', 'u1', '2026-01-01', '{}',
   'history-prototype/staging/1/object', 'checksum');`);
      const source = schema + `\nINSERT INTO users (id, username, created_at) VALUES ('u1', 'production-name', '2026-01-01');
INSERT INTO resource_changes (resource_kind, resource_id, action, actor_user_id, changed_at,
  snapshot_json) VALUES ('simulation', 'sim-1', 'updated', 'u1', '2026-01-01', '{"id":"sim-1"}');`;
      db.exec(sanitizeExport(source));
      expect(db.prepare('SELECT snapshot_json, archive_key, archive_digest FROM resource_changes').get())
        .toEqual({ snapshot_json: '{"id":"sim-1"}', archive_key: null, archive_digest: null });
    } finally { db.close(); }
  });
  it('rejects application schema drift before export or import', () => {
    expect(() => selectRefreshTables(['users'], ['users', 'sites'])).toThrow(/schema mismatch/);
    expect(() => selectRefreshTables(['users', 'sites'], ['users'])).toThrow(/schema mismatch/);
    expect(selectRefreshTables(['users', 'calculation_jobs'], ['users'])).toEqual(['users']);
    expect(() => selectRefreshTables(['users'], ['users', 'auth_session'])).toThrow(/credential reset/);
  });
  it('classifies the deployed schema including transient calculation jobs without exporting jobs', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(schema);
      db.exec(readFileSync('db/migrations/2026-03-25_calculation_jobs.sql', 'utf8'));
      const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
      expect(names).toContain('calculation_jobs');
      expect(selectExportTables(names)).not.toContain('calculation_jobs');
      expect(selectExportTables(names)).toContain('users');
    } finally { db.close(); }
  });
  it('excludes explicitly classified auth tables and rejects unknown tables', () => {
    expect(selectExportTables(['users', 'auth_user', 'auth_session', 'auth_passkey', 'auth_identity_map'])).toEqual(['users']);
    expect(() => selectExportTables(['users', 'future_credentials'])).toThrow(/Unclassified/);
  });
  it('sanitizes before generating the import and preserves legacy relationships', () => {
    const input = schema + `\nINSERT INTO users (id, username, email, idp_email, idp_email_verified, bio, created_at) VALUES ('u1','realname','secret@example.org','secret@example.org',1,'private bio','2026-01-01');\nINSERT INTO verified_identity_claims (normalized_email,current_user_id,status,created_at,updated_at) VALUES ('secret@example.org','u1','active','2026-01-01','2026-01-01');\nINSERT INTO identity_subject_states (user_id,normalized_email,status,canonical_user_id,created_at,updated_at) VALUES ('u1','secret@example.org','current','u1','2026-01-01','2026-01-01');`;
    const output = sanitizeExport(input);
    expect(output).not.toMatch(/secret@example|private bio|realname/);
    const db = new DatabaseSync(':memory:');
    db.exec(output);
    db.exec(output); // Replacing a previous sanitized fixture remains safe.
    expect(db.prepare('SELECT id FROM users').get().id).toBe('u1');
    expect(db.prepare('SELECT idp_email FROM users').get().idp_email).toBe(db.prepare('SELECT normalized_email FROM verified_identity_claims').get().normalized_email);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });
  it('rejects auth data or unknown tables accidentally present in an export', () => {
    expect(() => sanitizeExport(schema + '\nCREATE TABLE auth_session (token TEXT);')).toThrow();
    expect(() => sanitizeExport(schema + '\nCREATE TABLE unknown (secret TEXT);')).toThrow();
  });
  it('refuses archived history references before a staging import can copy production bucket keys', () => {
    const withArchiveColumns = schema + `
ALTER TABLE resource_changes ADD COLUMN archive_key TEXT;
ALTER TABLE resource_changes ADD COLUMN archive_digest TEXT;
INSERT INTO resource_changes (resource_kind, resource_id, action, actor_user_id, changed_at,
  snapshot_json, details_json, archive_key, archive_digest)
VALUES ('site', 'site-1', 'updated', 'u1', '2026-01-01', '{}', '{}',
  'history/production/1/object', 'checksum');`;
    expect(() => sanitizeExport(withArchiveColumns)).toThrow(/archived history.*staging/i);
    // A half-written reference is unsafe too, even if only one column is populated.
    expect(() => sanitizeExport(withArchiveColumns.replace("'history/production/1/object', 'checksum'", "NULL, 'checksum'")))
      .toThrow(/archived history.*staging/i);
  });
  it('rewrites every verified archive copy to a staging-only reference before import', () => {
    const sourceKey = 'history-prototype/production/1/11111111-1111-4111-8111-111111111111';
    const stagingKey = `history-prototype/staging/1/${'b'.repeat(64)}`;
    const source = schema + `\n${archiveMigration}\nINSERT INTO users(id,username,created_at) VALUES('u1','production-name','2026-01-01');
INSERT INTO resource_changes(id,resource_kind,resource_id,action,actor_user_id,changed_at,
  snapshot_json,archive_key,archive_digest) VALUES
  (1,'simulation','sim-1','updated','u1','2026-01-01','{"id":"sim-1"}',
   '${sourceKey}','${'a'.repeat(64)}');`;
    const copy = { id: 1, sourceKey, sourceDigest: 'a'.repeat(64), stagingKey, stagingDigest: 'b'.repeat(64) };
    const output = sanitizeExport(source, [copy]);
    expect(output).not.toContain(sourceKey);
    const staging = new DatabaseSync(':memory:');
    try {
      staging.exec(output);
      expect(staging.prepare('SELECT archive_key,archive_digest FROM resource_changes WHERE id=1').get())
        .toEqual({ archive_key: stagingKey, archive_digest: 'b'.repeat(64) });
      expect(staging.prepare('SELECT username FROM users WHERE id=?').get('u1').username).toBe('staging-user-1');
    } finally { staging.close(); }
    for (const invalid of [[], [{ ...copy, sourceDigest: 'c'.repeat(64) }],
      [{ ...copy, stagingKey: sourceKey }], [copy, copy]]) {
      expect(() => sanitizeExport(source, invalid)).toThrow();
    }
    expect(() => sanitizeExport(source)).toThrow(/archived history.*staging/i);
  });
  it('keeps inline history usable when the future archive columns are empty', () => {
    const input = schema + `
ALTER TABLE resource_changes ADD COLUMN archive_key TEXT;
ALTER TABLE resource_changes ADD COLUMN archive_digest TEXT;
INSERT INTO resource_changes (resource_kind, resource_id, action, actor_user_id, changed_at,
  snapshot_json, details_json) VALUES ('site', 'site-1', 'updated', 'u1', '2026-01-01',
  '{"snapshot":{"name":"Site"}}', '{"changedFields":["name"]}');`;
    const output = sanitizeExport(input);
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(output);
      expect(db.prepare('SELECT snapshot_json, details_json, archive_key, archive_digest FROM resource_changes').get())
        .toEqual({ snapshot_json: '{"snapshot":{"name":"Site"}}', details_json: '{"changedFields":["name"]}', archive_key: null, archive_digest: null });
    } finally { db.close(); }
  });
  it('replaces staging-only archived rows with sanitized inline production history on refresh', () => {
    const source = schema + `
INSERT INTO users (id, username, created_at) VALUES ('u1', 'production-name', '2026-01-01');
INSERT INTO resource_changes (resource_kind, resource_id, action, actor_user_id, changed_at,
  snapshot_json, details_json) VALUES ('simulation', 'sim-1', 'updated', 'u1', '2026-01-01',
  '{"id":"sim-1","snapshot":{"name":"Inline"}}', '{}');`;
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(schema);
      db.exec('ALTER TABLE resource_changes ADD COLUMN archive_key TEXT; ALTER TABLE resource_changes ADD COLUMN archive_digest TEXT;');
      db.exec(`INSERT INTO users (id, username, created_at) VALUES ('u1', 'staging-name', '2026-01-01');
INSERT INTO resource_changes (resource_kind, resource_id, action, actor_user_id, changed_at,
  snapshot_json, details_json, archive_key, archive_digest) VALUES
  ('simulation', 'sim-1', 'updated', 'u1', '2026-01-01', '{"id":"sim-1"}', '{}',
   'history-prototype/staging/1/object', 'checksum');`);
      db.exec(sanitizeExport(source));
      expect(db.prepare('SELECT snapshot_json, archive_key, archive_digest FROM resource_changes').get())
        .toEqual({snapshot_json:'{"id":"sim-1","snapshot":{"name":"Inline"}}',archive_key:null,archive_digest:null});
      expect(db.prepare('SELECT username FROM users WHERE id = ?').get('u1').username).toBe('staging-user-1');
    } finally { db.close(); }
  });
  it('rejects an incomplete archive schema before exporting history', () => {
    expect(() => sanitizeExport(schema + '\nALTER TABLE resource_changes ADD COLUMN archive_key TEXT;'))
      .toThrow(/incomplete archive schema/i);
  });
});
