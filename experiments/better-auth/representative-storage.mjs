import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { indexedArchiveSchema } from './history-archive-indexed-schema.mjs';

// Synthetic sizing fixture: counts and approximate JSON lengths come from the
// 2026-09-18 staging aggregate. No real resource or identity data is copied.
const timestamp = '2026-09-18 12:00:00';
const blocks = (start, end, width = 100) => {
  const result = [];
  for (let first = start; first <= end; first += width) result.push([first, Math.min(first + width - 1, end)]);
  return result;
};
const numbers = (first, last) => `WITH RECURSIVE n(i) AS (SELECT ${first} UNION ALL SELECT i+1 FROM n WHERE i<${last})`;

export function schemaSql() {
  return indexedArchiveSchema() + readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
}

export function* seedSql() {
  yield `${numbers(1, 50)} INSERT INTO users(id,username,created_at) SELECT 'synthetic-user-'||i,'synthetic-'||i,'${timestamp}' FROM n`;
  for (const [first, last] of blocks(1, 9201)) {
    yield `${numbers(first, last)} INSERT INTO resource_changes
      (id,resource_kind,resource_id,action,actor_user_id,changed_at,snapshot_json,details_json)
      SELECT i, CASE WHEN i<=3845 THEN 'simulation' ELSE 'site' END,
      'synthetic-resource-'||(i%471), 'updated', 'synthetic-user-'||(i%50+1), '${timestamp}',
      CASE WHEN i<=2155 THEN
        '{"ownerUserId":"synthetic-user-'||(i%50+1)||'","visibility":"'||
        CASE WHEN i%100<37 THEN 'public' ELSE 'private' END||
        '","sharedWith":[],"snapshot":"'||hex(randomblob(3000))||'"}'
      WHEN i<=3845 THEN
        '{"ownerUserId":"synthetic-user-'||(i%50+1)||'","visibility":"private","sharedWith":[],"data":"'||hex(randomblob(1000))||'"}'
      ELSE '{"ownerUserId":"synthetic-user-'||(i%50+1)||'","visibility":"private","data":"'||hex(randomblob(350))||'"}' END,
      CASE WHEN i<=2155 THEN '{"diff":{"snapshot":"'||hex(randomblob(140))||'"}}' ELSE '{}' END
      FROM n`;
  }
}

// D1-only projection for physical sizing. The keys are deliberately unusable:
// this disposable database has no R2 archive and cannot serve application reads.
export function* projectSql() {
  for (const [first, last] of blocks(1, 2155)) {
    yield `UPDATE resource_changes SET
      archive_key='synthetic-nonrecoverable/'||printf('%064d',id),
      archive_digest=printf('%064d',id),
      snapshot_json=json_remove(snapshot_json,'$.snapshot'),
      details_json=json_remove(details_json,'$.diff.snapshot')
      WHERE id BETWEEN ${first} AND ${last}`;
  }
}

// Explicit capacity allowance using the current *probe* schema, not a promise
// that the final Better Auth integration will have the same physical footprint.
export function* authSql() {
  for (const [first, last] of blocks(51, 1000)) {
    yield `${numbers(first, last)} INSERT INTO users(id,username,created_at) SELECT 'synthetic-user-'||i,'synthetic-'||i,'${timestamp}' FROM n`;
  }
  for (const [first, last] of blocks(1, 1000)) {
    yield `${numbers(first, last)} INSERT INTO probe_user(id,name,email,emailVerified,createdAt,updatedAt)
      SELECT 'synthetic-auth-'||i,'Synthetic '||i,'synthetic-'||i||'@invalid.example',1,'${timestamp}','${timestamp}' FROM n`;
    yield `${numbers(first, last)} INSERT INTO probe_account(id,accountId,providerId,userId,createdAt,updatedAt)
      SELECT 'synthetic-account-'||i,'synthetic-provider-'||i,'github','synthetic-auth-'||i,'${timestamp}','${timestamp}' FROM n`;
    yield `${numbers(first, last)} INSERT INTO probe_session(id,expiresAt,token,createdAt,updatedAt,userId)
      SELECT 'synthetic-session-'||i,'2026-10-18','synthetic-token-'||i,'${timestamp}','${timestamp}','synthetic-auth-'||i FROM n`;
    yield `${numbers(first, last)} INSERT INTO probe_rate_limit(id,key,count,lastRequest)
      SELECT 'synthetic-rate-'||i,'synthetic-key-'||i,1,0 FROM n`;
  }
  for (const [first, last] of blocks(1, 250)) {
    yield `${numbers(first, last)} INSERT INTO probe_passkey(id,publicKey,userId,credentialID,counter,deviceType,backedUp)
      SELECT 'synthetic-passkey-'||i,hex(randomblob(120)),'synthetic-auth-'||i,'synthetic-credential-'||i,0,'singleDevice',0 FROM n`;
  }
}

function outputSql(statements) {
  return [...statements].map(statement => `${statement};\n`).join('');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2];
  if (!directory) throw new Error('Usage: node representative-storage.mjs <disposable output directory>');
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, '01-schema.sql'), schemaSql());
  for (const [name, statements] of [
    ['02-seed.sql', seedSql()],
    ['03-project.sql', projectSql()], ['04-auth.sql', authSql()],
  ]) writeFileSync(resolve(directory, name), outputSql(statements));
}
