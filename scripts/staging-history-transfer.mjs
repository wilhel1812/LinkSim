import { DatabaseSync } from 'node:sqlite';
import { copyArchivedHistoryRowForStaging } from '../functions/_lib/historyArchive.ts';
import { selectExportTables } from './staging-table-inventory.mjs';

// Source rows are read from the same private D1 export the sanitizer will use.
// No production binding or bucket is mutated by this operator-only helper.
export async function copyArchivedRowsForStaging(sql, productionBucket, stagingBucket) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(sql);
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all().map(row => row.name);
    const tables = selectExportTables(names);
    if (tables.length !== names.length || !tables.includes('users')) throw Error('Invalid application export for archive transfer');
    if (!tables.includes('resource_changes')) return [];
    const columns = new Set(db.prepare('PRAGMA table_info(resource_changes)').all().map(row => row.name));
    if (columns.has('archive_key') !== columns.has('archive_digest')) throw Error('Incomplete archive schema');
    if (!columns.has('archive_key')) return [];
    const rows = db.prepare('SELECT id,archive_key,archive_digest FROM resource_changes WHERE archive_key IS NOT NULL OR archive_digest IS NOT NULL ORDER BY id').all();
    for (const row of rows) {
      if (!Number.isSafeInteger(row.id) || row.id < 1 ||
          !new RegExp(`^history-prototype/production/${row.id}/[0-9a-f-]{36}$`).test(row.archive_key ?? '') ||
          !/^[0-9a-f]{64}$/.test(row.archive_digest ?? '')) throw Error('Invalid production archive reference');
    }
    const sourceDb = { prepare: query => ({ bind: (...args) => ({ first: async () => db.prepare(query).get(...args) }) }) };
    const source = { DB: sourceDb, BUCKET: productionBucket, scope: 'production' };
    const copies = [];
    // Keep R2 concurrency bounded without starting the next page after a failure.
    for (let start = 0; start < rows.length; start += 4) {
      const page = await Promise.allSettled(rows.slice(start, start + 4)
        .map(row => copyArchivedHistoryRowForStaging(source, stagingBucket, row.id)));
      const failed = page.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      copies.push(...page.map(result => result.value));
    }
    return copies;
  } finally { db.close(); }
}

export function getR2TransferCredentials(env = process.env) {
  const accountId = env.R2_ACCOUNT_ID;
  const sourceId = env.R2_HISTORY_SOURCE_ACCESS_KEY_ID;
  const sourceSecret = env.R2_HISTORY_SOURCE_SECRET_ACCESS_KEY;
  const sourceSession = env.R2_HISTORY_SOURCE_SESSION_TOKEN;
  const stagingId = env.R2_HISTORY_STAGING_ACCESS_KEY_ID;
  const stagingSecret = env.R2_HISTORY_STAGING_SECRET_ACCESS_KEY;
  const stagingSession = env.R2_HISTORY_STAGING_SESSION_TOKEN;
  const sameCredentials = sourceId === stagingId && sourceSecret === stagingSecret &&
    (sourceSession ?? '') === (stagingSession ?? '');
  if (!/^[a-f0-9]{32}$/.test(accountId ?? '') || !sourceId || !sourceSecret ||
      !stagingId || !stagingSecret || sameCredentials) {
    throw Error('Separate production-read and staging-write R2 credentials are required for archived history refresh');
  }
  return {
    accountId,
    source: {
      accessKeyId: sourceId,
      secretAccessKey: sourceSecret,
      ...(sourceSession ? { sessionToken: sourceSession } : {}),
    },
    staging: {
      accessKeyId: stagingId,
      secretAccessKey: stagingSecret,
      ...(stagingSession ? { sessionToken: stagingSession } : {}),
    },
  };
}

export async function copyArchivedRowsWithR2(sql) {
  let clients;
  let connectionPromise;
  const connect = () => connectionPromise ??= (async () => {
    const credentials = getR2TransferCredentials();
    const { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const endpoint = `https://${credentials.accountId}.r2.cloudflarestorage.com`;
    clients = {
      source: new S3Client({ region: 'auto', endpoint, credentials: credentials.source }),
      staging: new S3Client({ region: 'auto', endpoint, credentials: credentials.staging }),
      GetObjectCommand, HeadObjectCommand, PutObjectCommand,
    };
    return clients;
  })();
  const bucket = (name, side) => ({
    async head(key) {
      if (side !== 'staging') throw Error('Only staging archive metadata is queried');
      try {
        const { HeadObjectCommand, staging: client } = await connect();
        const response = await client.send(new HeadObjectCommand({ Bucket: name, Key: key }));
        return { size: response.ContentLength ?? 0 };
      } catch (error) {
        if (error?.name === 'NotFound' || error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
        throw Error('Staging history archive metadata could not be read');
      }
    },
    async get(key) {
      try {
        const { GetObjectCommand, [side]: client } = await connect();
        const response = await client.send(new GetObjectCommand({ Bucket: name, Key: key }));
        if (!response.Body) throw Error('Empty archive response');
        return { size: response.ContentLength ?? 0, text: () => response.Body.transformToString() };
      } catch (error) {
        if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
        throw Error('History archive object could not be read');
      }
    },
    async put(key, raw) {
      if (side !== 'staging') throw Error('Production archive is read-only during staging refresh');
      try {
        const { PutObjectCommand, staging: client } = await connect();
        await client.send(new PutObjectCommand({ Bucket: name, Key: key, Body: raw, ContentType: 'application/json' }));
      } catch { throw Error('Staging history archive object could not be written'); }
    },
  });
  try {
    return await copyArchivedRowsForStaging(sql, bucket('linksim-history', 'source'), bucket('linksim-history-staging', 'staging'));
  } finally { clients?.source.destroy(); clients?.staging.destroy(); }
}
