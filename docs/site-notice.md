# Site Notice Operations

LinkSim can publish one narrow banner across every application route without an application release. The notice is presentation only: it does not change authentication or account-registration policy. New drafts default to dismissible, while administrators can turn dismissal off for a notice that must remain visible.

## Preferred path

An administrator can open **Settings → Admin → Site notice**, choose a tone, enter a message, optionally set an expiry or allow dismissal, preview it, and publish or remove it. Each change increments the notice revision and writes an audit record containing the actor, source, previous value, and new value.

Browsers refresh `/site-status.json` on page load, once per minute, when the window regains focus, and immediately after an admin-panel update. The public endpoint contains only display-safe notice fields and fails open with no banner if D1 is unavailable.

## Out-of-band fallback

If the application admin path is unavailable, run the protected **Update LinkSim Site Notice** GitHub Actions workflow. Select `staging` or `production`, then `publish` or `clear`. Production uses the existing protected GitHub environment and Cloudflare credentials; the workflow updates the same D1 record and audit table without deploying Pages.

For `publish`, supply a tone and a message of at most 280 characters. The optional expiry must be an ISO-8601 timestamp. Workflow runs are serialized per environment so two operator updates cannot overlap.

The D1 schema is installed by `db/migrations/2026-08-20_site_notice.sql`. Normal staging and production deployment jobs apply the migration idempotently on every deployment, then verify the singleton row before deploying the application.
