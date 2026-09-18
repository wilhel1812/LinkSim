import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { selectExportTables, selectRefreshTables, sanitizeExport } from './staging-export.mjs';
const schema = readFileSync('db/schema.sql', 'utf8');
describe('staging export boundary', () => {
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
  it('rejects an incomplete archive schema before exporting history', () => {
    expect(() => sanitizeExport(schema + '\nALTER TABLE resource_changes ADD COLUMN archive_key TEXT;'))
      .toThrow(/incomplete archive schema/i);
  });
});
