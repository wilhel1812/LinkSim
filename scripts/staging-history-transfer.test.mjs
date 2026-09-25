import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { hydrateHistoryRow } from '../functions/_lib/historyArchive.ts';
import { sanitizeExport } from './staging-export.mjs';
import {
  copyArchivedRowsForStaging,
  copyArchivedRowsWithR2,
  getR2TransferCredentials,
} from './staging-history-transfer.mjs';

const schema = readFileSync('db/schema.sql', 'utf8');
const migration = readFileSync('db/migrations/2026-09-18_history_archive.sql', 'utf8');
const sourceKey = 'history-prototype/production/1/11111111-1111-4111-8111-111111111111';
const original = '{"id":"sim-1","snapshot":{"name":"Old"}}';
const raw = JSON.stringify({ version: 1, scope: 'production', id: 1, snapshot_json: original, details_json: null });
const checksum = createHash('sha256').update(raw).digest('hex');
const source = `${schema}\n${migration}\nINSERT INTO users(id,username,created_at) VALUES('u1','production-name','2026-01-01');
INSERT INTO resource_changes(id,resource_kind,resource_id,action,actor_user_id,changed_at,
 snapshot_json,archive_key,archive_digest) VALUES
 (1,'simulation','sim-1','updated','u1','2026-01-01','{"id":"sim-1"}','${sourceKey}','${checksum}');`;

class Bucket {
  objects = new Map();
  failPut = false;
  corruptRead = false;
  async head(key) { return this.objects.has(key) ? { size: this.objects.get(key).length } : null; }
  async get(key) {
    const raw = this.objects.get(key);
    if (raw === undefined) return null;
    const text = this.corruptRead ? `${raw}corrupt` : raw;
    return { size: new TextEncoder().encode(text).length, text: async () => text };
  }
  async put(key, value) {
    if (this.failPut) throw Error('put failed');
    this.objects.set(key, value);
  }
}

describe('archive-aware staging refresh transfer', () => {
  it('keeps temporary source and staging session credentials separated', () => {
    expect(getR2TransferCredentials({
      R2_ACCOUNT_ID: '85c57e0c4da3a747a09212dc5b090f52',
      R2_HISTORY_SOURCE_ACCESS_KEY_ID: 'source-id',
      R2_HISTORY_SOURCE_SECRET_ACCESS_KEY: 'source-secret',
      R2_HISTORY_SOURCE_SESSION_TOKEN: 'source-session',
      R2_HISTORY_STAGING_ACCESS_KEY_ID: 'staging-id',
      R2_HISTORY_STAGING_SECRET_ACCESS_KEY: 'staging-secret',
      R2_HISTORY_STAGING_SESSION_TOKEN: 'staging-session',
    })).toEqual({
      accountId: '85c57e0c4da3a747a09212dc5b090f52',
      source: {
        accessKeyId: 'source-id',
        secretAccessKey: 'source-secret',
        sessionToken: 'source-session',
      },
      staging: {
        accessKeyId: 'staging-id',
        secretAccessKey: 'staging-secret',
        sessionToken: 'staging-session',
      },
    });
  });

  it('keeps long-lived credential compatibility and rejects incomplete pairs', () => {
    const permanent = {
      R2_ACCOUNT_ID: '85c57e0c4da3a747a09212dc5b090f52',
      R2_HISTORY_SOURCE_ACCESS_KEY_ID: 'source-id',
      R2_HISTORY_SOURCE_SECRET_ACCESS_KEY: 'source-secret',
      R2_HISTORY_STAGING_ACCESS_KEY_ID: 'staging-id',
      R2_HISTORY_STAGING_SECRET_ACCESS_KEY: 'staging-secret',
    };
    expect(getR2TransferCredentials(permanent)).toEqual({
      accountId: permanent.R2_ACCOUNT_ID,
      source: { accessKeyId: 'source-id', secretAccessKey: 'source-secret' },
      staging: { accessKeyId: 'staging-id', secretAccessKey: 'staging-secret' },
    });
    expect(() => getR2TransferCredentials({
      ...permanent,
      R2_HISTORY_STAGING_SECRET_ACCESS_KEY: '',
    })).toThrow('Separate production-read and staging-write R2 credentials are required');
    expect(() => getR2TransferCredentials({
      ...permanent,
      R2_HISTORY_STAGING_ACCESS_KEY_ID: 'source-id',
      R2_HISTORY_STAGING_SECRET_ACCESS_KEY: 'source-secret',
    })).toThrow('Separate production-read and staging-write R2 credentials are required');

    expect(getR2TransferCredentials({
      ...permanent,
      R2_HISTORY_STAGING_ACCESS_KEY_ID: 'source-id',
      R2_HISTORY_SOURCE_SESSION_TOKEN: 'source-session',
      R2_HISTORY_STAGING_SESSION_TOKEN: 'staging-session',
    })).toMatchObject({
      source: { accessKeyId: 'source-id', sessionToken: 'source-session' },
      staging: { accessKeyId: 'source-id', sessionToken: 'staging-session' },
    });
  });

  it('verifies a production object, copies it to staging and imports only a staging reference', async () => {
    const production = new Bucket(); production.objects.set(sourceKey, raw);
    const staging = new Bucket();
    const copies = await copyArchivedRowsForStaging(source, production, staging);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ id: 1, sourceKey, sourceDigest: checksum });
    expect(copies[0].stagingKey).toMatch(/^history-prototype\/staging\/1\//);
    expect(copies[0].stagingKey).not.toBe(sourceKey);
    const output = sanitizeExport(source, copies);
    expect(output).not.toContain(sourceKey);
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(output);
      const adapter = { prepare: sql => ({ bind: (...args) => ({ first: async () => db.prepare(sql).get(...args) }) }) };
      expect(await hydrateHistoryRow({ DB: adapter, BUCKET: staging, scope: 'staging' }, 1))
        .toMatchObject({ snapshot_json: original });
      expect(db.prepare('SELECT username FROM users WHERE id=?').get('u1').username).toBe('staging-user-1');
    } finally { db.close(); }
  });

  it('fails before import on missing, corrupt or unwritable objects', async () => {
    const staging = new Bucket();
    await expect(copyArchivedRowsForStaging(source, new Bucket(), staging)).rejects.toThrow();
    const corrupt = new Bucket(); corrupt.objects.set(sourceKey, `${raw}wrong`);
    await expect(copyArchivedRowsForStaging(source, corrupt, staging)).rejects.toThrow();
    const production = new Bucket(); production.objects.set(sourceKey, raw);
    staging.failPut = true;
    await expect(copyArchivedRowsForStaging(source, production, staging)).rejects.toThrow();
    staging.failPut = false; staging.corruptRead = true;
    await expect(copyArchivedRowsForStaging(source, production, staging)).rejects.toThrow();
  });

  it('needs no bucket access for inline rows and rejects incomplete references', async () => {
    const inline = `${schema}\n${migration}\nINSERT INTO users(id,username,created_at) VALUES('u1','name','2026-01-01');
INSERT INTO resource_changes(id,resource_kind,resource_id,action,actor_user_id,changed_at,snapshot_json)
VALUES(1,'simulation','sim-1','updated','u1','2026-01-01','{}');`;
    const copies = await copyArchivedRowsForStaging(inline, { get: () => { throw Error('unexpected'); } },
      { put: () => { throw Error('unexpected'); } });
    expect(copies).toEqual([]);
    expect(sanitizeExport(inline, copies)).not.toContain('history-prototype/production');
    expect(await copyArchivedRowsWithR2(inline)).toEqual([]);
    await expect(copyArchivedRowsForStaging(source.replace(`'${checksum}'`, 'NULL'), new Bucket(), new Bucket()))
      .rejects.toThrow();
  });
});
