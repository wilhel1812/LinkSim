# Resource limits

LinkSim rejects untrusted input before it can create disproportionate parsing,
storage, or database work. These are application safety contracts, not
Cloudflare account or billing limits.

## Library writes

`PUT /api/library` applies these limits before calling the existing Library
database helpers:

| Resource | Limit |
| --- | ---: |
| Encoded request body | 2 MiB |
| JSON nesting | 20 levels |
| Combined Sites and Simulations per request | 20 |
| Encoded Site record | 32 KiB |
| Encoded Simulation record | 256 KiB |
| Sites in one Simulation | 250 |
| Paths in one Simulation | 1,000 |
| Grants on one record | 100 |
| Sites owned by one user | 500 |
| Simulations owned by one user | 100 |
| Public/shared Sites owned by one user | 100 |
| Public/shared Simulations owned by one user | 25 |

The client sends larger sync sets as sequential 20-record batches. If a batch
fails, it stops and retains the dirty set so the normal sync recovery path can
retry safely. The server never silently truncates a batch.
Soft-deleted Simulations retain their payload for lifecycle recovery and
therefore continue to count toward both Simulation storage quotas.

Owners already above a storage quota can continue to update, export,
privatize, or delete existing records. Authenticated Site deletion removes the
owned cloud record before detaching its local references; the existing change
history carries deletion tombstones to stale clients and prevents recreation.
Deletion is idempotent so an interrupted retry can recover. Platform admins may
also delete a Site. Collaborators cannot delete someone else's Site. Owners
cannot create a record or make a record public when that would increase an
exceeded quota.

Known Site and Simulation fields are validated for object shape, identifiers,
names, finite numeric values, coordinates, visibility, grants, and collection
counts. Unknown extension fields remain compatible as long as the complete
record stays inside its encoded-byte limit.

Failures are JSON responses: `413` for request bytes, `422` for malformed or
over-quota content, and the existing authentication/authorization statuses for
access failures. A rejected request does not silently discard records.
