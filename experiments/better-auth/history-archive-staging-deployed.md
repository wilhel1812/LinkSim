# Deployed staging archive runtime probe

This disposable Worker/Durable Object measures actual Cloudflare CPU and R2
retention for issue #1107. It is **not** part of Pages, does not enable automatic
archiving, and must not be deployed to production. Its generated config is
fixed to the reviewed staging D1 ID and private history bucket. A random Worker
name avoids replacing any existing service. The public `workers.dev` gateway
and object both require a 256-bit secret, expire after 20 minutes, and accept
only the chosen synthetic row's exact ID, resource and actor. The secret is
stored in an ignored, mode-0600 file and uploaded as a Cloudflare secret.
Never print it or save raw Wrangler tails.

The previously created synthetic row `9202` was restored inline, so it can be
rehearsed again. Confirm that it still has the expected identity and null
archive columns before preparing a new run. Run these commands from the repo:

```sh
node experiments/better-auth/history-archive-staging-deployed.mjs prepare 9202 simulation archive-rehearsal-sim-1107-20260918 archive-rehearsal-user-1107-20260918
node experiments/better-auth/history-archive-staging-deployed.mjs deploy
```

Start a sanitized tail collector in another terminal before invoking the
operations. The collector discards request headers and records only status,
path, CPU, wall time, outcome and script version:

```sh
archive_root="$PWD"
mkdir -p experiments/better-auth/.wrangler/history-staging-deployed/tail
(cd experiments/better-auth/.wrangler/history-staging-deployed/tail && \
  "$archive_root/node_modules/.bin/wrangler" tail --config ../wrangler.json --format json | \
  node "$archive_root/experiments/better-auth/summarize-tail.mjs")
```

Then run one operation at a time and verify each reports `verified: true`:

```sh
node experiments/better-auth/history-archive-staging-deployed.mjs call object-count
node experiments/better-auth/history-archive-staging-deployed.mjs call dry-run
node experiments/better-auth/history-archive-staging-deployed.mjs call archive
node experiments/better-auth/history-archive-staging-deployed.mjs call hydrate
node experiments/better-auth/history-archive-staging-deployed.mjs call restore
node experiments/better-auth/history-archive-staging-deployed.mjs call object-count
node experiments/better-auth/history-archive-staging-deployed.mjs delete
```

The object-count operation uses an R2 `list` scoped to this one staging row and
returns only an aggregate count, never keys or content. A zero count exits
nonzero. The first count should confirm the retained object from the earlier
local run; the final count should confirm it remains after this restore.
Record only sanitized call and tail results. Confirm the D1 row matches the
original Simulation payload and has null archive columns after restore.

`delete` removes only the randomly named Worker and its temporary object; it
never deletes staging D1 or R2. Run it even after expiry or a failed call. If
an archive result is ambiguous, first reconcile D1 and restore the synthetic
row. The private R2 objects must remain because D1 backups/Time Travel may
still reference them. A deployed CPU result on this synthetic row still does
not replace the later authenticated application revert, Manual Sync and
sanitized-refresh staging checks.
