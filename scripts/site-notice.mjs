import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_MESSAGE_LENGTH = 280;
const databases = { staging: "linksim_staging", production: "linksim" };
const env = process.env;
const target = env.NOTICE_TARGET ?? "";
const action = env.NOTICE_ACTION ?? "";
const tone = env.NOTICE_TONE ?? "";
const message = (env.NOTICE_MESSAGE ?? "").trim().replace(/\s+/g, " ");
const dismissible = env.NOTICE_DISMISSIBLE === "true";
const expiresAt = (env.NOTICE_EXPIRES_AT ?? "").trim();
const actor = (env.NOTICE_ACTOR ?? "github-actions").slice(0, 120);
const runId = (env.NOTICE_RUN_ID ?? "unknown").slice(0, 120);

const fail = (text) => { throw new Error(text); };
if (!(target in databases)) fail("NOTICE_TARGET must be staging or production.");
if (!['publish', 'clear'].includes(action)) fail("NOTICE_ACTION must be publish or clear.");
if (!['information', 'warning', 'incident'].includes(tone)) fail("NOTICE_TONE is invalid.");
if (action === "publish" && !message) fail("A publish action requires a message.");
if (message.length > MAX_MESSAGE_LENGTH) fail(`Message exceeds ${MAX_MESSAGE_LENGTH} characters.`);
if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) fail("NOTICE_EXPIRES_AT must be ISO-8601.");

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const now = new Date().toISOString();
const source = `github-actions:${runId}`;
const active = action === "publish" ? 1 : 0;
const nextMessage = action === "publish" ? message : "";
const nextDismissible = action === "publish" && dismissible ? 1 : 0;
const nextExpiry = action === "publish" && expiresAt ? quote(new Date(expiresAt).toISOString()) : "NULL";

const sql = `
CREATE TEMP TABLE previous_site_notice AS SELECT * FROM site_notice WHERE singleton = 1;
INSERT INTO site_notice
  (singleton, active, tone, message, dismissible, starts_at, expires_at, revision, updated_at, updated_by)
VALUES (1, ${active}, ${quote(tone)}, ${quote(nextMessage)}, ${nextDismissible}, NULL, ${nextExpiry}, 1, ${quote(now)}, ${quote(actor)})
ON CONFLICT(singleton) DO UPDATE SET
  active = excluded.active,
  tone = excluded.tone,
  message = excluded.message,
  dismissible = excluded.dismissible,
  starts_at = NULL,
  expires_at = excluded.expires_at,
  revision = site_notice.revision + 1,
  updated_at = excluded.updated_at,
  updated_by = excluded.updated_by;
INSERT INTO site_notice_audit (action, actor_id, source, previous_json, next_json, created_at)
VALUES (
  ${quote(action)}, ${quote(actor)}, ${quote(source)},
  (SELECT json_object('active', active = 1, 'tone', tone, 'message', message, 'dismissible', dismissible = 1, 'startsAt', starts_at, 'expiresAt', expires_at, 'revision', revision, 'updatedAt', updated_at, 'updatedBy', updated_by) FROM previous_site_notice LIMIT 1),
  (SELECT json_object('active', active = 1, 'tone', tone, 'message', message, 'dismissible', dismissible = 1, 'startsAt', starts_at, 'expiresAt', expires_at, 'revision', revision, 'updatedAt', updated_at, 'updatedBy', updated_by) FROM site_notice WHERE singleton = 1),
  ${quote(now)}
);
DROP TABLE previous_site_notice;
`;

const workingDirectory = mkdtempSync(join(tmpdir(), "linksim-site-notice-"));
const sqlFile = join(workingDirectory, "site-notice.sql");
try {
  writeFileSync(sqlFile, sql, { encoding: "utf8", mode: 0o600 });
  execFileSync(join(process.cwd(), "node_modules", ".bin", "wrangler"), [
    "d1", "execute", databases[target], "--remote", "--file", sqlFile, "--yes",
  ], { stdio: "inherit" });
} finally {
  rmSync(workingDirectory, { recursive: true, force: true });
}
