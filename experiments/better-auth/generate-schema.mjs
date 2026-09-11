import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { getMigrations } from 'better-auth/db/migration';
import { probeOptions } from './probe.mjs';

const database = new DatabaseSync(':memory:');
try {
  const migration = await getMigrations(probeOptions({
    DB: database,
    PROBE_ORIGIN: 'https://auth-probe.example',
    BETTER_AUTH_SECRET: 'disposable-test-secret-with-at-least-32-characters',
  }));
  writeFileSync('schema.sql', await migration.compileMigrations());
} finally { database.close(); }
