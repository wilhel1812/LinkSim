# Post-provision R2 inventory (2026-09-26)

Status: **complete read-only account inventory.** The production history bucket
exists, remains empty and unbound, and the existing archive caps pass. The
account still does not have sustained Free-tier headroom; the maintainer's
bounded billing decision in
[#1192](https://github.com/wilhel1812/LinkSim/issues/1192) remains required.
This evidence does not authorize archive activation, authentication cutover,
billing changes, object cleanup or any production write.

## Complete account inventory

Between **2026-09-26T15:35:55Z and 2026-09-26T15:36:07Z**, Wrangler 4.131.0
listed all six R2 buckets in the deployment account and queried each bucket's
provider summary. Every bucket was classified: five LinkSim buckets and one
unrelated quota-sharing bucket. The account identifier, unrelated bucket name,
and its exact object and byte counts are intentionally omitted from public
evidence.

The commands read bucket metadata only. They did not list keys, read object
contents, change bindings or lifecycle rules, or write or delete objects.
Wrangler's bucket summary is sampled analytics and may lag the query interval;
it is not an immutable object-by-object audit.

| Bucket | Classification | Objects | Stored bytes shown by Wrangler |
| --- | --- | ---: | ---: |
| `linksim-avatars` | Production avatars | 10 | 1.41 MB |
| `linksim-avatars-staging` | Staging avatars | 4 | 6.53 MB |
| `linksim-history` | Unbound production history | 0 | 0 B |
| `linksim-history-staging` | Retained staging archive rehearsal objects | 5 | 824 kB |
| `linksim-terraform-state` | Terraform state; quota-sharing LinkSim operations | 2 | 51.9 kB |
| Other classified account bucket | Unrelated quota-sharing use; private inventory retained by operator | Not published | More than 10 GB |

The five LinkSim buckets total approximately **8.82 MB**. Current history use
is **0 B in production**, **824 kB in staging**, and **824 kB combined**. This is
below the 3 GB-per-environment and 6 GB-combined operating caps. The production
bucket has no objects after the completed disposable transfer rehearsal; the
five older staging objects remain protected by the backup/Time Travel-aware
retention contract in the
[storage decision](2026-09-25-r2-storage-capacity.md).

The unrelated bucket alone remains above both the 4 GB non-history envelope and
the 10 GB account allowance. Less than 6 GB remains inside that allowance for
the approved archive envelope. The sustained Free-tier gate therefore still
fails, but this is the exact condition covered by the maintainer's bounded
billing acceptance: approximately USD 0.06/month of incremental LinkSim R2
storage at the 3.31 GB point sensitivity is accepted, the unrelated account
charge remains outside LinkSim, and any higher LinkSim-attributable estimate
requires a new decision.

## Separate billing-period metric

The current-size inventory was not used as a proxy for monthly usage. A
separate read-only Cloudflare GraphQL Analytics query covered
**2026-09-01T00:00:00Z through 2026-09-26T15:39:20Z** and returned 4,897 R2
storage samples across 26 UTC days. The last sample was
**2026-09-26T15:20:00Z**.

For each bucket and UTC day, the query selected the maximum reported
`payloadSize + metadataSize`, then summed the per-bucket daily maxima. This is a
conservative account measure because bucket maxima may occur at different
times. The unrelated bucket's September-to-date average daily peak by itself
is above **10 GB**, so the Free storage allowance fails without relying on that
cross-bucket conservatism. Exact unrelated usage remains private.

The new `linksim-history` bucket had two observed UTC days and a maximum of
0 bytes. `linksim-history-staging` had nine observed UTC days and a maximum of
824,321 bytes. This query verifies the history thresholds independently of the
single latest bucket-summary sample. It does not replace Cloudflare's invoice
or establish the final full-month GB-month value before the billing period
closes.

## Gate result

The post-provision inventory gate is complete:

1. Every account bucket is classified.
2. Production history is below 3 GB.
3. Staging history is below 3 GB.
4. Combined history is below 6 GB.
5. Non-history use remains above 4 GB and the account lacks Free-tier headroom.
6. The existing bounded-billing exception explicitly covers that failed
   Free-tier condition without changing the archive caps.
7. September-to-date storage analytics were checked separately from the current
   snapshot.

Archive activation remains blocked on the other production-cutover checklist
items and separate production approval. This file supersedes only the dated
account-inventory snapshot in the 2026-09-25 storage decision; that file's
envelope model, caps, retention rules, cleanup prohibitions and billing
decision remain authoritative.

Sources: [R2 pricing](https://developers.cloudflare.com/r2/pricing/) and
[R2 metrics and analytics](https://developers.cloudflare.com/r2/platform/metrics-analytics/).
