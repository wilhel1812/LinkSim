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

- Route browser forward location search through the guarded same-origin endpoint; production clients do not fall back directly to Nominatim for forward search.
- Cache normalized geocoding queries for five minutes and cap provider responses at six results and 64 KiB.
- Apply the configured per-caller limit (60 requests per minute by default) plus a one-request-per-second cache-miss gate per running isolate. These controls are per environment/isolate, not an application-global guarantee.
- Preserve explicit provider throttling and failure messages without silently retrying.

## Mesh feeds and external node directories

- Treat these feeds as third-party data with potential usage limits.
- Do not assume permanent endpoint stability.
- Keep source URL visibility and provenance in UI where data is imported.

## Operational controls

- Maintain request limiting on proxy routes.
- Keep feature flags/fallback paths for provider outages.
- Prioritize source independence work in backlog to reduce single-source risk.
