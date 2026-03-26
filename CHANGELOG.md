# Changelog

All notable changes to this project are documented here in a human-readable format.

## [0.11.0] - 2026-03-26

### Added
- Deep links now update the browser URL live as selection state changes, so shared links always match the current context.
- Terrain and calculation requests are routed through async job endpoints to improve reliability under longer-running workloads.

### Changed
- Onboarding is consolidated into a simpler welcome flow with clearer entry points to Simulation Library and Site Library.
- Deep-link handling is more deterministic for multi-site selections and shorter shared link paths.

### Fixed
- Deep-link parsing now handles emoji variation selectors and non-Latin names (including Korean) more consistently.
- Blank Simulation workflows no longer get stuck during startup/reload edge cases.
- Terrain calculation path no longer depends on the reverted Pages proxy experiment; production path is stabilized.

### Internal
- Removed temporary deep-link debug instrumentation after validation.
- Updated release and staging workflow guardrails documentation.

## [0.10.3] - 2026-03-24

### Fixed
- Restored stable blank Simulation loading/session behavior so empty workspace flows continue correctly.

## [0.10.2] - 2026-03-23

### Changed
- Promoted staging release guardrails to main for safer branch, deploy, and promotion flow.

## [0.10.1] - 2026-03-22

### Fixed
- Aligned production Copernicus proxy rate limits with staging to avoid environment-specific terrain behavior.

## [0.10.0] - 2026-03-22

### Added
- Added version-based migration framework and standardized client storage migration policy.
- Added profile-click temporary Site draft behavior to speed up map-driven planning.

### Changed
- Improved startup responsiveness through deferred non-critical loading and terrain prioritization.
- Refined onboarding and workspace entry behavior by removing forced starter workspace autoload.
- Simplified terrain UX with clearer loading states, continuation messaging, and preview-to-refined updates.
- Improved library filter controls with grouped, persisted filters and compact layout.

### Fixed
- Hardened startup fallback behavior and hover/profile interaction edge cases.
- Stabilized Copernicus throttling behavior and reduced terrain loading stalls.
- Unified LOS model behavior across views and reduced link-switch jank.
