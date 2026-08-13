import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const identitySql = readFileSync("db/staging-anonymize-identity.sql", "utf8");
const refreshScript = readFileSync("scripts/refresh-staging-d1.sh", "utf8");

describe("staging refresh identity anonymization", () => {
  it("preserves claim aliases and canonical joins without retaining production emails", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, idp_email TEXT, idp_email_verified INTEGER NOT NULL);
      CREATE TABLE verified_identity_claims (
        normalized_email TEXT PRIMARY KEY, current_user_id TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE identity_subject_states (
        user_id TEXT PRIMARY KEY, normalized_email TEXT, status TEXT NOT NULL, canonical_user_id TEXT
      );
      INSERT INTO users VALUES
        ('subject-a', 'staging+subject-@example.invalid', 1),
        ('subject-b', 'staging+subject-b@example.invalid', 1);
      INSERT INTO verified_identity_claims VALUES
        ('primary@example.com', 'subject-a', 'active'),
        ('alias@example.com', 'subject-a', 'active'),
        ('other@example.com', 'subject-b', 'active');
      INSERT INTO identity_subject_states VALUES
        ('subject-a', 'primary@example.com', 'current', 'subject-a'),
        ('old-subject', 'alias@example.com', 'superseded', 'subject-a'),
        ('subject-b', 'other@example.com', 'current', 'subject-b'),
        ('blocked-subject', 'blocked@example.com', 'blocked', 'blocked-subject');
    `);

    db.exec(identitySql);

    const claims = db.prepare("SELECT normalized_email, current_user_id FROM verified_identity_claims ORDER BY normalized_email").all() as Array<Record<string, string>>;
    expect(claims).toHaveLength(3);
    expect(new Set(claims.map((row) => row.normalized_email)).size).toBe(3);
    expect(JSON.stringify(claims)).not.toMatch(/primary@example|alias@example|other@example/);

    const canonical = db.prepare(`
      SELECT u.idp_email, s.normalized_email
      FROM users u JOIN identity_subject_states s ON s.user_id = u.id
      WHERE u.id = 'subject-a'
    `).get() as { idp_email: string; normalized_email: string };
    expect(canonical.idp_email).toBe(canonical.normalized_email);
    expect(claims).toContainEqual({ normalized_email: canonical.normalized_email, current_user_id: "subject-a" });

    const subjects = db.prepare("SELECT normalized_email FROM identity_subject_states").all() as Array<{ normalized_email: string }>;
    expect(JSON.stringify(subjects)).not.toMatch(/primary@example|alias@example|other@example|blocked@example/);
  });

  it("runs lifecycle anonymization only when both migrated tables exist in the imported dump", () => {
    expect(refreshScript).toContain("db/staging-anonymize-identity.sql");
    expect(refreshScript).toMatch(/grep.+verified_identity_claims/);
    expect(refreshScript).toMatch(/grep.+identity_subject_states/);
  });
});
