# Privacy Notice

Last updated: 2026-03-13

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

## Why data is processed

- Authenticate and authorize access.
- Support collaboration, ownership, and moderation.
- Preserve audit history for security and abuse handling.

## Data sharing

- LinkSim uses third-party infrastructure providers (Cloudflare services) to run the app.
- Public profile visibility is configurable in-app (for fields that support visibility controls).
- Admins and moderators may access moderation-related records required for operations.

## Retention

- Data is retained while accounts/resources are active, and audit logs may be retained longer for security and abuse handling.
- Deleted-user lock records can be removed by admins for account recreation flows.

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
