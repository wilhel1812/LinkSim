# Changelog

All notable changes to this project are documented here in a human-readable format.

## [0.13.0] - 2026-04-02

### Added
- Private simulations can now be shared with specific users without elevating them to public. Collaborators are granted viewer or editor access per-user; the simulation and its sites stay private. The share link is auth-gated — only explicitly added users can open it. (#142)
- Share modal redesigned with two equal option cards: "Make Broadly Accessible" (existing public upgrade path) and "Share with Specific Users" (new private collaboration path), each with an icon. (#142)
- Per-collaborator role selector (viewer / editor) in the resource access dialog. (#142)
- Anonymous visitors now land on a demo workspace with four real Oslo-area sites (Tryvannstårnet, Haukåsen, Kikut, Kolsåstoppen) instead of an empty map, giving a clear first impression of the tool. (#346)
- Meshmap MQTT node data now loads with a progress bar and shows a retry button on failure, consistent with the terrain and simulation loading patterns. (#292, #294)

### Changed
- Sidebar "More" panel reduced — actions consolidated into more appropriate locations, reducing clutter and improving focus. (#182)

### Fixed
- Cloud auto-sync no longer fails after sharing a private simulation with specific users. The `simulation_private_site_reference` conflict is suppressed during sync for private simulations; strict validation is kept only when explicitly upgrading a simulation to shared/public. (#142)
- New sites created in areas without terrain data no longer silently default to elevation 0 — elevation is resolved from live terrain data at creation time. (#181)
- Path profile fullscreen button no longer triggers map fullscreen; the two controls now operate independently. (#309)
- "Fit" button now correctly fits the viewport to the simulation area in all cases, including a Mercator cos(lat) correction for accuracy. (#223)
- Map search in the site editor now pans the map to the selected result immediately. (#95)
- Mobile map attribution placement is now stable across all panel and tab states. (#240)
- Meshmap proxy no longer caches error responses (429/5xx) — only successful responses are cached, preventing stale error states. (#294)
- Map UI pill is now correctly centered in expanded mode. (#300)
- Removed the redundant "Inspector" heading from the inspector panel header. (#142)
- Panel toggle button is now left-aligned on desktop and hidden on mobile; Share button stays right-aligned in both modes. (#142)
- Clipboard permission error when saving collaborators resolved — clipboard write is now registered within the user-gesture context before async operations begin. (#142)

## [0.12.1] - 2026-03-28

### Fixed
- Holiday theme state is now shared across all UI consumers (AppShell, MapView, Sidebar). Clicking "Revert Theme" in the map inspector immediately reverts the color without requiring a page refresh.
- Yellow Easter theme option now appears in the color theme dropdown during the active Easter window, and disappears afterward.

## [0.12.0] - 2026-03-28

### Added
- Mobile: tabbed interface splits map/profile view and sidebar for better small-screen layout.
- Desktop: right-side inspector panel for simulation results alongside the sidebar.
- Easter holiday theme framework with automatic seasonal activation and window management.
- Holiday theme system is reusable for future seasonal overrides.

### Changed
- Unified UI iconography with the Lucide icon set across all controls, map buttons, and sidebar.
- Map UI controls consolidated into the sidebar; removed floating overlays on mobile.
- iOS: map renders full-bleed behind safe areas with proper viewport anchoring.
- Sidebar header simplified to icon-only row; environment badge moved to title area.
- Basemap fallback now uses Carto Normal style instead of incorrect default layer.

### Fixed
- Fullscreen toggle for map and path profile now operate independently.
- Mobile attribution placement is stable across panel open/close states.
- iOS map canvas sizing is consistent across orientation changes and viewport updates.
- Coverage store extracted from main Zustand store to reduce re-render overhead.

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
