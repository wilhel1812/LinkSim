#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const [action, value, rawMinutes = "15"] = process.argv.slice(2);

const run = (sql) => {
  const result = spawnSync("npx", ["wrangler", "d1", "execute", "linksim_staging", "--remote", "--command", sql, "--yes"], {
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
};

if (action === "list") {
  run(`SELECT users.id, users.username, users.email, users.is_admin, users.is_moderator,
    CASE WHEN mapping.auth_user_id IS NULL THEN 'not-migrated' ELSE 'migrated' END AS migration_state
    FROM users LEFT JOIN auth_identity_map AS mapping ON mapping.linksim_user_id = users.id
    LEFT JOIN deleted_users AS deleted ON deleted.id = users.id
    WHERE deleted.id IS NULL AND (users.is_admin = 1 OR users.is_moderator = 1)
    ORDER BY users.username, users.id;`);
} else if (action === "authorize") {
  if (!UUID.test(value ?? "")) throw new Error("authorize requires the exact privileged LinkSim user UUID");
  const minutes = Number(rawMinutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 30) throw new Error("expiry must be 5-30 minutes");
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
  run(`UPDATE auth_privileged_passkey_recovery SET revoked_at = '${createdAt}'
    WHERE linksim_user_id = '${value}' AND consumed_at IS NULL AND revoked_at IS NULL
      AND expires_at <= '${createdAt}';
    INSERT INTO auth_privileged_passkey_recovery
    (id, linksim_user_id, expected_access_subject, created_by, created_at, expires_at)
    SELECT '${id}', users.id, users.id, 'operator:wrangler', '${createdAt}', '${expiresAt}'
    FROM users
    LEFT JOIN deleted_users AS deleted ON deleted.id = users.id
    LEFT JOIN identity_subject_states AS state ON state.user_id = users.id
    LEFT JOIN auth_identity_map AS mapping ON mapping.linksim_user_id = users.id
    WHERE users.id = '${value}' AND deleted.id IS NULL AND mapping.linksim_user_id IS NULL
      AND state.status = 'current' AND state.canonical_user_id = users.id
      AND users.is_approved = 1 AND (users.is_admin = 1 OR users.is_moderator = 1)
      AND COALESCE(users.approved_by_user_id, '') NOT LIKE 'revoked:%';
    SELECT id, linksim_user_id, created_at, expires_at, started_at, consumed_at, revoked_at
    FROM auth_privileged_passkey_recovery WHERE id = '${id}';`);
} else if (action === "revoke") {
  if (!UUID.test(value ?? "")) throw new Error("revoke requires the recovery authorization UUID");
  run(`UPDATE auth_privileged_passkey_recovery SET revoked_at = '${new Date().toISOString()}'
    WHERE id = '${value}' AND consumed_at IS NULL AND revoked_at IS NULL;
    SELECT id, linksim_user_id, expires_at, consumed_at, revoked_at
    FROM auth_privileged_passkey_recovery WHERE id = '${value}';`);
} else {
  throw new Error("Usage: node scripts/manage-staging-admin-passkey-recovery.mjs list | authorize <LinkSim user UUID> [5-30 minutes] | revoke <authorization UUID>");
}
