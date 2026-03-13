# Third-Party Source Compliance Notes

Last updated: 2026-03-13

This document defines operating rules when LinkSim consumes external data/services.

## Core principles

- Respect each provider's terms and attribution requirements.
- Use caching and rate limiting to reduce unnecessary upstream load.
- Prefer fail-safe behavior (clear user-facing error + fallback) over silent retries.

## Terrain data

- Terrain tile selection/fetch must stay within published source constraints.
- Avoid bulk/background scraping patterns that exceed intended usage.
- Keep source attribution visible in-app/docs.

## Geocoding and elevation APIs

- Route requests through guarded server endpoints when available.
- Apply request caps and short-lived cache where practical.
- Handle upstream failures with explicit user messaging and fallback behavior.

## Mesh feeds and external node directories

- Treat these feeds as third-party data with potential usage limits.
- Do not assume permanent endpoint stability.
- Keep source URL visibility and provenance in UI where data is imported.

## Operational controls

- Maintain request limiting on proxy routes.
- Keep feature flags/fallback paths for provider outages.
- Prioritize source independence work in backlog to reduce single-source risk.
