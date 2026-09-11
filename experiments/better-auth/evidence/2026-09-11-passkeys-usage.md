# Virtual passkeys and account usage, 2026-09-11

Status: this validation batch strengthens compatibility evidence. Overall
capacity acceptance remains pending; no application migration or cutover.

## Passkeys

The existing local workerd/D1 harness now has an optional `--passkeys` extension.
Chromium 151.0.7922.34 (the installed Playwright cache build) generated a real
virtual credential and assertions. Better Auth/SimpleWebAuthn verified them
through the existing private-binding transport. Provider/bootstrap identities
remain synthetic, and every browser URL is intercepted locally. There is no live
credential access, new dependency, or custom cryptography.

Passed: registration and login for the expected synthetic user; rejection of
registration replay, exact successful-assertion replay, a correctly signed old
challenge paired with a new challenge cookie, a different origin, a different
RP hash with the original origin/signing key, a bogus signature, and a removed
credential, plus cross-user credential removal. A successful assertion after the
negative cases confirms the credential remains usable. Rejections returned 400/401, minted no session cookie, and left the
session count unchanged. Credential removal left no stored passkey for that user.
This tests browser-generated assertions against local production-library code;
it is not a remote negative-ceremony measurement or physical-device matrix.

The documented Chrome DevTools WebAuthn API supplies virtual authentication,
credential re-scoping and invalid-signature injection:
https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/

## Read-only Cloudflare dashboard snapshot

Observed around 11:14–11:23 Europe/Oslo. Counts are snapshots with differing
windows and dashboard update delays; do not add incompatible windows. A separate
read-only aggregate query confirmed 50 stored production user records (50 rows
read, zero writes); this is not a count of daily active people.

| Surface | Window | Observed |
|---|---|---|
| Account Workers/Pages | Today, partial day | 4,567 / 100,000 requests |
| Production Pages Functions | Rolling 24 hours | 5,824 successes, 0 errors |
| Staging Pages Functions, Production selector | Rolling 24 hours | 1,976 successes, 0 errors |
| D1 account usage | September 11, partial day | 29.21k reads, 1.51k writes |
| D1 stored size | Current | 112.23 MB total: production 88.2 MB, staging 23.93 MB, probe 102.4 kB |
| Durable Object usage | Displayed current billing period | 356 requests, 2.16 GB-seconds, no billed cost |
| Durable Object namespace | Rolling 24 hours | 108 client-disconnected events; 0 CPU-limit, memory-limit, internal or thrown-exception events |
| Durable Object namespace | Last 30 minutes | All displayed error categories 0 |

D1 data remains in D1; the object's reported zero SQL storage is not evidence
that auth credentials occupy no space. These observations concern authentication
capacity, not a claim that every service on the account is cost-free.

The mixed-version object totals include prior failing transport experiments.
The recent error-free window supports the targeted `ok` traces; it does not
prove every historical disconnect's cause or satisfy the full-day/week gates.
Likewise, 2.16 GB-seconds is an observed small-sample billable-duration metric,
not a validated per-user extrapolation. Keep the conservative duration model.

The production D1 detail page was internally inconsistent even after refresh:
its rolling-24-hour summary showed 113k reads and 3k writes, while the regional
chart legends showed 154.44k reads and 2.43k writes. Both were labeled for the
same selected window. Treat this as unresolved dashboard aggregation/rounding
ambiguity; do not silently choose whichever number gives more headroom. The
query table also showed 3,030 site-notice reads, but SQL counts cannot be
subtracted directly from the Function request total.

## Implications

A write sensitivity using the chart's 2,430 app writes instead of the earlier
1,035 would add `(2,430 - 1,035) * 20 = 27,900` to the accepted 53,700 scenario,
reaching about 81,600/day. Using the rounded 3,000 summary gives about 93,000/day.
These are unvalidated linear sensitivities, not new capacity estimates or an
extension of the maintainer's accepted exception. Separate fixed/administrative
work from user activity before making a commitment.

The 1,000-user target remains unchanged, but the updated production request
baseline is higher than the earlier 4,063/day snapshot. A naive 20-fold scale of
5,824 is 116,480/day before new auth/staging overhead. Do not silently substitute
the assumed 30-protected-requests-per-day scenario for historical activity.

Production still runs the earlier release without the traffic reductions;
shared staging contains those reductions but has different traffic and tester
activity. The staging total is therefore not evidence of a particular percentage
saving. A representative workload/request-count comparison and later real
post-reduction production baseline remain necessary. Production deployment of
traffic reductions would itself require separate release approval.

Remaining gates include genuinely cold Pages gateway CPU, quota-failure behavior,
representative post-reduction request volume, and workload-based storage/write
maintenance reserves. The narrow accepted 53,700-write sensitivity exception
still applies; no other allowance or gate has been waived.
