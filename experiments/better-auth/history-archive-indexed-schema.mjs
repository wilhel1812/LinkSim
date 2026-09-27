import { readFileSync } from 'node:fs';

// Local synthetic fixture only. Read the real application schema so the cost
// comparison includes its JSON expression and partial history indexes.
export function indexedArchiveSchema() {
  return readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8') + `
ALTER TABLE resource_changes ADD COLUMN archive_key TEXT;
ALTER TABLE resource_changes ADD COLUMN archive_digest TEXT;
`;
}

// The remote probe loads synthetic rows through Wrangler. Fixture setup is
// outside the measured requests, but each statement must fit D1's size limit.
export function remoteArchiveFixtureSql(rows, { indexed, minimalSchema } = {}) {
  if (!indexed && !minimalSchema) throw new Error('Minimal fixture schema required');
  const indexes = indexed
    ? [...readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8').matchAll(/CREATE INDEX IF NOT EXISTS (idx_resource_changes_\w+)[^\n]*;/g)]
    : [];
  if (indexed && indexes.length !== 6) throw new Error('History index definitions changed; review remote fixture setup');
  const statements = indexed
    // Chunked inserts temporarily contain incomplete JSON, so expression
    // indexes must be rebuilt only after complete synthetic rows are loaded.
    ? [...indexes.map(([, name]) => `DROP INDEX IF EXISTS ${name}`), 'DELETE FROM resource_changes']
    : ['DROP TABLE IF EXISTS resource_changes', minimalSchema];
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || row.id < 1) throw new Error('Invalid synthetic row ID');
    statements.push(indexed
      ? `INSERT INTO resource_changes(id,resource_kind,resource_id,action,actor_user_id,changed_at,snapshot_json,details_json) VALUES(${row.id},'simulation','synthetic-${row.id}','updated','synthetic-owner','2026-09-18','','')`
      : `INSERT INTO resource_changes(id,snapshot_json,details_json) VALUES(${row.id},'','')`);
    for (const field of ['snapshot_json', 'details_json']) {
      const value = row[field];
      if (typeof value !== 'string') throw new Error('Invalid synthetic history value');
      for (let offset = 0; offset < value.length;) {
        let end = Math.min(value.length, offset + 14_000);
        while (Buffer.byteLength(quote(value.slice(offset, end)), 'utf8') > 15_000) end = offset + Math.floor((end - offset) / 2);
        if (end <= offset) throw new Error('Cannot bound synthetic SQL statement');
        statements.push(`UPDATE resource_changes SET ${field}=${field}||${quote(value.slice(offset, end))} WHERE id=${row.id}`);
        offset = end;
      }
    }
  }
  if (indexed) statements.push(...indexes.map(([definition]) => definition.slice(0, -1)));
  return statements.join(';\n') + ';\n';
}
