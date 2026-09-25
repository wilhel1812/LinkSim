# Authentication staging release readiness (2026-09-25)

Status: **qualified go to complete production preparation at the current scale;
conditional capacity acceptance for the 1,000-registered-account target.** This
is not production approval and not a 1,000-daily-active-user guarantee.

The exact stable-staging tree was
`9f653ff1603e0e7c057f07932277332393d53576`. Deployment run
[36117699361](https://github.com/wilhel1812/LinkSim/actions/runs/36117699361)
passed the application and Better Auth schema probes, secret setup, private auth
runtime deployment, guarded Pages deployment and post-deploy Access check. The
corresponding Pages deployment was `983e90b4-671b-45f6-b8a1-e9bec3afc1d1`.
Production remained unchanged and Access-authoritative.

## Rehearsal evidence

The release audit reused completed ceremonies rather than asking maintainers to
repeat them:

- GitHub login/logout, callback confirmation, session revocation and actionable
  errors were verified through #1144 and #1158-#1160.
- Passkey enrollment, sign-in, rename/removal, fresh-auth enforcement and real
  device behavior were verified through #1152 and #1163. Local browser/runtime
  coverage rejects replay, wrong challenge, origin, RP, signature and owner.
- Ordinary verified-email claiming and new registration were verified through
  #1150. The external paired Access/GitHub migration completed on 2026-09-25
  through #1164-#1172 and retained its existing LinkSim identity.
- The exceptional administrator recovery completed through #1175/#1176. The
  maintainer signed out, returned with the passkey and verified administrator
  settings plus migration status. The one-passkey exception remains explicitly
  accepted because no second authenticator is available.
- Admin migration status and its exact aggregate were verified through #1174.
- Archived plus inline history revert and full Manual Sync already completed in
  the #1107 rehearsal. Repeating the destructive fixture was unnecessary.

The final exact-tree checks added:

- `node scripts/access-boundary.mjs check staging` passed. The shell and auth
  bootstrap remain public, ordinary protected APIs return application `401`,
  and the legacy proof route remains behind the narrow Access application.
- A retained signed-in browser session loaded build
  `v0.29.0-beta+9f653ff1`, showed cloud sync **Up to date**, and exposed its
  Better Auth passkey in Profile settings.
- `/<simulation>`, `/<simulation>/<site>`,
  `/<simulation>/<site1>+<site2>` and
  `/<simulation>/<site1>~<site2>` loaded the same exact build using valid saved
  Svalbard resources, with no load error. The simulation-only URL restored the
  last selected Site, matching existing navigation behavior.
- The focused auth, migration, route-boundary, passkey and settings suite passed
  231 tests in this audit. Repository-wide validation remains the pull-request
  gate for these documentation changes.
- The checked-in production mode remained `active: false` with
  `accessBoundary: broad`; no production workflow or mutation ran.

One human-only staging check remains: a manual VoiceOver spot-check of the
sign-in popover, native passkey handoff announcements, Profile passkey actions,
error/fallback guidance and focus return. Automated accessibility-tree coverage
already passed. This spot-check does not require another account migration or
credential change. The production checklist now blocks cutover until this check,
the tested build and the browser/device are recorded in release evidence.

## Bounded capacity decision

The capacity model uses the Cloudflare Free limits recorded in the dated source
evidence below; the linked provider documentation remains the release-time
authority:
[Workers](https://developers.cloudflare.com/workers/platform/limits/) allows
100,000 requests/day with 10 ms CPU per invocation;
[Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)
allows 100,000 requests and 13,000 GB-s/day;
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) allows
5 million rows read and 100,000 rows written/day; and
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/) keeps each
Free database at 500 MB and the account at 5 GB. Standard
[R2](https://developers.cloudflare.com/r2/pricing/) includes 10 GB-month,
1 million Class A and 10 million Class B operations per month. Exceeding a
Free daily compute or D1 operation allowance fails operations; it does not
create a per-user charge.

These are sensitivities, not measured future usage:

| Dimension | 1,000-account sensitivity | Interpretation |
| --- | ---: | --- |
| Worker requests | 48,063/day at 30 app requests per DAU; 68,063 at 50 | 48.1% or 68.1% of the hard daily limit |
| Durable Object requests | 46,063/day at 30; 66,063 at 50 | 46.1% or 66.1% of the hard daily limit |
| D1 reads | 2.235 million/day | 44.7%; historical stress model |
| D1 writes before archive maintenance | 53,700/day | 53.7%; maintainer-accepted narrow exception |
| D1 writes with bounded archive maintenance | up to 61,700/day | 61.7%; adds the 8,000/day maintenance sensitivity and requires separate operational acceptance |
| Object duration | 3,072 GB-s/day | 23.6%; assumption-based rather than billed telemetry |
| D1 storage | 476,303,360 bytes | 4.7% below the conservative 500,000,000-byte ceiling after the archive projection |
| R2 storage | at least about 2.77 GB with staging copy | Lower bound only; total size and Free-tier headroom remain unresolved until envelopes, retained versions, other objects, retention and growth are bounded |

The request-only equation crosses the original 50% planning line at about
**638 daily active users at 50 protected app requests each**, or **1,064 at 30**.
That arithmetic places the 1,000-DAU/30-request stress case below the line, but
neither threshold is a supported-user estimate: the activity counts and fixed
reserves are modeled assumptions rather than measured future traffic. The
project target is 1,000 registered accounts with activity comparable to today's
users, not 1,000 daily active users.

Storage remains the binding registered-user dimension. Two accepted planning
sensitivities bracket roughly **958 to 1,000 registered accounts**: 958 is the
earlier reserve-oriented estimate, while the representative projected fixture
fits 1,000 with only 4.7% margin. This is not a validated supported-user range.
User history is highly skewed, so no unconditional single maximum is defensible.
Reaching 1,000 on Free depends on completing and operating the tested R2 archive
path before D1 approaches its ceiling, bounding retention, and monitoring actual
growth. Inline-only linear scaling is not a 1,000-user design.

Archive maintenance also changes the write budget. The accepted 53,700-write
sensitivity does not include permission for the separate 8,000 maintenance
writes/day. Their combined **61,700 writes/day** sensitivity is below the hard
100,000 daily allowance but above the accepted narrow exception and therefore
requires explicit operational acceptance before archive activation. Likewise,
the 2.77 GB R2 projection is only a lower bound. It cannot establish 10 GB of
headroom until the remaining object bytes and retention policy are measured.

The live 59-request auth sample measured gateway CPU averaging 1.407 ms with a
3 ms maximum, and object CPU averaging 2.661 ms with a 47 ms maximum. It proves
the warm session transport sample, not representative cold Pages/application
CPU. Browser elapsed time is not CPU time. The remaining CPU and billable object
duration uncertainty can only be resolved with production-like traffic after
the protected transition deployment. The production checklist defines the
first-hour/day/week reviews and rollback order. It now also requires numeric
stop/rollback triggers, the responsible operator and reviewer approval to be
recorded before the cutover window. Selecting and approving those values remains
a pre-cutover release condition.

## Decision and safeguards

Proceeding to production preparation is reasonable at the observed approximately
50-account scale because the deployed authentication behavior, security boundary
and migration paths are verified, while the dated daily and storage observations
retain large absolute room at that size. The release must retain:

1. the inactive/broad fail-closed mode until a separately approved cutover;
2. active billing/usage warnings and recorded pre-cutover baselines;
3. pre-cutover approval of explicit registration/claim stop and rollback
   triggers for resource-limit errors, quota use and D1/R2 storage growth, using
   the explicit gate in the production checklist;
4. first-hour/day/week request, D1, object-duration, CPU/error and storage review;
5. completion/activation of bounded R2 history maintenance before D1 storage
   approaches the 500 MB ceiling; and
6. the ordered Access-first rollback from the production checklist.

This is a **qualified capacity go**, not proof that 1,000 users can be accepted
without observation or archive maintenance. If representative CPU produces
resource-limit failures, if the modeled write/load envelope is exceeded, or if
D1 growth cannot be held below the ceiling, pause registration and revise the
architecture or operation before claiming the target is met. Those qualitative
conditions do not replace the explicit operational triggers that must be
reviewed before cutover.

Sources: [registered-account decision](2026-09-18-registered-capacity-decision.md),
[activity model](2026-09-11-revised-activity-model.md),
[auth capacity](2026-09-11-capacity.md), and
[representative storage](2026-09-18-representative-physical-storage.md).
