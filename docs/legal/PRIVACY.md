# Privacy Notice

Last updated: 2026-08-16

This document describes how LinkSim handles user data.

## What data is stored

- Account/profile:
  - user ID
  - display name
  - email and identity-provider email
  - optional bio
  - optional avatar metadata/object keys
- Access and moderation:
  - role/status (pending/user/moderator/admin)
  - approval timestamps and approver IDs
  - access request note (if provided)
- Resource ownership and audit:
  - created/edited-by user IDs
  - change log events and moderation/audit events

## Sensitive information warning

Do not store secrets in LinkSim content (sites, simulations, notes, profile fields), including:
- passwords
- API keys/tokens
- private keys
- confidential credentials

Visibility/access settings are collaboration controls, not a secure secret vault.

## Why data is processed

- Authenticate and authorize access.
- Support collaboration, ownership, and moderation.
- Preserve audit history for security and abuse handling.

## Data sharing

- LinkSim uses third-party infrastructure providers (Cloudflare services) to run the app.
- Public profile visibility is configurable in-app (for fields that support visibility controls).
- Admins and moderators may access moderation-related records required for operations.

### Shared Simulations and Site coordinates

- A shared or public Simulation discloses the exact coordinates in its saved Site snapshot to everyone who can open that Simulation.
- Opening a shared or public Simulation also returns the Site records it references so the Simulation can be rendered. This includes exact coordinates from referenced Sites whose separate Library visibility is private.
- A private Site's Library visibility therefore does not hide its coordinates from readers of a Simulation in which it is referenced. Keep a Simulation private or limit it to specific collaborators when its locations should not be broadly disclosed.

### Third-party requests

- When a user saves a Site created from a map position, the browser sends the exact coordinates directly to the OpenStreetMap Nominatim service to suggest a Site name.
- LinkSim permits profile avatar URLs hosted outside LinkSim. Viewing one of these avatars makes the viewer's browser request the image directly from its host, which discloses the viewer's IP address and User-Agent to that host. LinkSim suppresses the HTTP referrer for these image requests.

### Public statistics and service metadata

- The public Stats endpoint and page count all Sites, including private Sites.
- Site geography is published in one-degree latitude/longitude bins. Bins are published from a count of one (`k=1`); there is no minimum-count suppression. This is LinkSim's approved public aggregation threshold.
- Aggregate growth, usage, and contribution data may also include activity from private resources, while private resource names, identifiers, links, and owners are omitted from the latest-Simulation list.
- The public `/api/health` endpoint reports the LinkSim service name, timestamp, build version, commit, build label, detected host and environment, and available Cloudflare Pages URL, branch, and commit metadata.

### Calculation jobs

- Calculation inputs and results may contain exact Site coordinates and other radio-planning data.
- Asynchronous calculation job identifiers are unauthenticated bearer capabilities. Anyone who obtains a job identifier can poll that job and read its status and result until it expires.
- Active jobs have a five-minute runtime limit. Completed, failed, and timed-out API calculation jobs are deleted during later calculation-job activity or when an expired job is polled. Records may remain stored longer during idle periods, and request-triggered cleanup retains no more than 1,000 terminal jobs.

## Retention

- Data is retained while accounts/resources are active, and audit logs may be retained longer for security and abuse handling.
- Deleted-user lock records can be removed by admins for account recreation flows.
- Asynchronous calculation-job retention follows the request-triggered cleanup behavior described above.

## Staging/test handling

- Production-to-staging refresh flows should anonymize user personal fields by default.
- Access to staging should be restricted to trusted operators.

## User rights and requests

For requests related to profile data correction or deletion, use the project issue tracker:
- https://github.com/wilhel1812/LinkSim/issues/new/choose

## Security

See:
- [SECURITY.md](../../SECURITY.md)

This notice can evolve as features and data flows change.
