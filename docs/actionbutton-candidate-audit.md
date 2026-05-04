# ActionButton Candidate Audit (Repo-wide)

Source of truth: UI Gallery (`/ui-gallery`)

Audit target: remaining `inline-action` / `inline-action danger` usages not already migrated to `ActionButton`.

## Classification Inventory

### Migrate to ActionButton now

#### `src/components/NotificationsPanel.tsx`
- Usage: refresh button in notifications popover (`inline-action`)
- Classification: migrate to ActionButton now
- Glossary reason: standard app action in panel content (ActionButton role), not a tool control/selection/tab/specialized trigger.

#### `src/components/SimulationResultsSection.tsx`
- Usage: LoRa helper action + export manifest action (`inline-action`)
- Classification: migrate to ActionButton now
- Glossary reason: standard command actions in normal panel flow (ActionButton role), no special styling semantics beyond default action.

### Keep as exception

#### `src/components/OnboardingTutorialModal.tsx`
- Usage: report CTA anchor with `inline-action tutorial-report-button`
- Classification: keep as exception
- Glossary reason: link-like/document/report CTA pattern, closer to `LinkButton`/contextual documentation action than core ActionButton migration target.

#### `src/components/InlineCloseIconButton.tsx`
- Usage: close icon affordance (`inline-action inline-action-icon`)
- Classification: keep as exception
- Glossary reason: dedicated close icon primitive category in glossary; not part of default/danger ActionButton family.

#### `src/components/WelcomeModal.tsx`
- Usage: `inline-action welcome-compact-button` onboarding choices
- Classification: keep as exception
- Glossary reason: specialized welcome entry-point treatment with custom compact styling; intentionally distinct from baseline action-family migration pass.

### Borderline / defer

#### `src/components/Sidebar.tsx`
- Usage: many mixed `inline-action`/`danger` controls across simulation/site/link/library/resource/admin flows
- Classification: borderline / defer
- Glossary reason: file mixes standard actions with selection-surface adjacency, special inline spans, filter trigger patterns, and high interaction density. Needs sub-slice planning to avoid over-migration risk.

#### `src/components/AppShell.tsx`
- Usage: mixed auth/dev/share/offline actions, includes icon-only inline-action usage in share modal
- Classification: borderline / defer
- Glossary reason: mixed contexts and semantics (some standard actions, some exception/icon flows). Better handled as scoped sub-pass.

#### `src/components/UserAdminPanel.tsx`
- Usage: large set of admin/moderation/account actions, plus modal management and destructive controls
- Classification: borderline / defer
- Glossary reason: high-volume, mixed-risk operational actions. ActionButton migration is likely valid for many controls but should be split by section to keep regression risk low.

## Bounded Migration Pass Implemented
- Included only “migrate now” set:
  - `src/components/NotificationsPanel.tsx`
  - `src/components/SimulationResultsSection.tsx`
- Excluded all exception and borderline/defer sets above.
