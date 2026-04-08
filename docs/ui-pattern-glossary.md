# UI Pattern Glossary (v1)

Purpose: shared vocabulary for UI cleanup and convergence work, grounded in current LinkSim usage.

Status labels:
- `standard`: preferred pattern for new work in this role
- `under migration`: actively converging to this pattern
- `exception`: intentional non-standard case
- `legacy`: older pattern retained until migrated
- `mapped only`: inventoried/visible in gallery, intentionally not converged in current pass

Current snapshot (after tabbed gallery and broad action convergence pass):
- Normal text-bearing app actions continue converging into one shared `ActionButton` family.
- `ToolButton` currently maps to icon-only map/workspace overlay controls in production UI.
- No active text-bearing ToolButton family is in use.
- Icon-only controls outside true overlay controls are mapped and tracked (`mapped only`) but not visually converged in this run.

## Proposed Outline
1. Standard patterns
2. Exceptions and specialized controls
3. Borderline/early categories (not standardized yet)

## Standard Patterns

### Panel Shells
- Role: structural app chrome shells that host content families; shell naming is independent from the feature content rendered inside.
- Use when: discussing layout/frame behavior (left side, right side, bottom shell) instead of feature-specific content.
- Do not use when: describing the internals of a feature module (map settings, profile chart details, library forms).
- Variants:
  - `LeftSidePanel` (current shell class: `sidebar-panel`)
  - `RightSidePanel` (current shell class: `map-inspector`, legacy name retained temporarily)
  - `BottomPanel` (current shell class: `chart-panel`, mobile host: `mobile-workspace-panel`)
- Known examples/files:
  - `src/components/AppShell.tsx`
  - `src/components/MapView.tsx`
  - `src/components/LinkProfileChart.tsx`
  - `src/index.css` (`.sidebar-panel`, `.map-inspector`, `.chart-panel`, `.mobile-workspace-panel*`)
- Status: `under migration`

Shell concerns vs content concerns:
- Shell concerns:
  - panel placement, visibility/expand/collapse, mobile tab hosting, shell spacing/chrome
- Content concerns:
  - Sidebar sections (Simulation/Site/Path/Radio/Data)
  - Right-panel inspector/details/map settings content
  - Bottom-panel path profile chart content

Legacy names to keep temporarily for stability:
- Keep `map-inspector` class/props for now (widely used selectors/props), but treat it as `RightSidePanel` in planning vocabulary.
- Keep `profile` naming for the bottom chart shell toggles/keys in current code until a dedicated rename pass is scoped.

### ActionButton
- Role: standard app action control (inline actions in modals, panels, and inspector actions).
- Use when: triggering an app action like Save, Load, Details, Create, Dismiss, or Remove.
- Do not use when: the control is a map/workspace tool control, a selection row/card, tab, or specialized trigger.
- Variants:
  - `default`
  - `danger`
- Known examples/files:
  - `src/components/ActionButton.tsx`
  - `src/components/SimulationLibraryPanel.tsx`
  - `src/components/MapView.tsx` (inspector action group + inline notice dismiss)
- Status: `under migration`

Boundary (simplified):
- Includes standard text-bearing app actions in side panels, inspector sections, dialogs, popovers, and modal form actions.
- Excludes true overlay tool controls, link-style actions, tabs, selection surfaces, and icon-only utilities.

### ToolButton
- Role: map/workspace overlay controls and view tools.
- Use when: zooming, fitting, panel show/hide, and map-side helper actions tied to overlay/tool context.
- Do not use when: action belongs to standard app action family (ActionButton) in forms/modals/normal panel flows.
- Variants:
  - `map-control-btn map-control-btn-icon`
- Known examples/files:
  - `src/components/MapView.tsx`
  - `src/components/AppShell.tsx`
  - `src/index.css` (`.map-control-btn*`)
- Status: `standard`

Boundary (strict):
- Includes map/workspace overlay controls and panel visibility/resize controls in workspace chrome.
- Must not be used for text-bearing form/app-flow actions inside panel/modal content.

### SelectionSurface
- Role: selectable rows/cards/items representing entities or choices.
- Use when: selecting a Site, Path, user row, or candidate item.
- Do not use when: action is command-like (Save/Delete/Apply).
- Variants:
  - `site-row`
  - `link-item`
  - `library-row user-list-row-btn`
  - `site-quick-item`
- Known examples/files:
  - `src/components/Sidebar.tsx`
  - `src/components/UserAdminPanel.tsx`
  - `src/index.css` (`.site-row`, `.link-item`, `.site-quick-item`, `.library-row`)
- Status: `standard`

Boundary (stabilized):
- Handles entity selection state (selected/active rows/cards).
- Must not be used as a substitute for command actions.

### TabButton
- Role: panel-switching tabs with tab semantics.
- Use when: switching mobile workspace panels.
- Do not use when: action is command-like or selection-card-like.
- Variants:
  - `mobile-workspace-tab`
  - `mobile-workspace-tab is-active`
- Known examples/files:
  - `src/components/app-shell/MobileWorkspaceTabs.tsx`
  - `src/index.css` (`.mobile-workspace-tab`)
- Status: `standard`

### Modal/Panel Shell
- Role: reusable overlay and card shell patterns for dialogs/popup workflows.
- Use when: presenting focused modal content with dismiss behavior.
- Do not use when: inline section can stay in normal layout without overlay interruption.
- Variants:
  - `ModalOverlay` tier `base`
  - `ModalOverlay` tier `raised`
  - card shell via `library-manager-card` and context-specific card classes
- Known examples/files:
  - `src/components/ModalOverlay.tsx`
  - `src/components/SimulationLibraryPanel.tsx`
  - `src/components/UserAdminPanel.tsx`
  - `src/components/Sidebar.tsx`
- Status: `standard`

Shell/header/action-row convergence note:
- Panel headers (`section-heading`, `library-manager-header`, inspector/chart top rows) now follow a shared header rhythm baseline.
- Form action rows (`chip-group` in panel/modal action contexts) now follow a shared action-row cadence baseline.

### Form Field + Action Group
- Role: consistent pairing of field layout and nearby actions.
- Use when: presenting label/input pairs with local action groups (filter actions, save/create groups).
- Do not use when: data is purely presentational or should be list/card selection.
- Variants:
  - `field-grid`
  - `chip-group` for clustered actions
- Known examples/files:
  - `src/components/SimulationLibraryPanel.tsx`
  - `src/components/UserAdminPanel.tsx`
  - `src/index.css` (`.field-grid`, `.chip-group`)
- Status: `standard`

## Exceptions and Specialized Controls

### LinkButton (text-link style action)
- Role: inline, low-emphasis action styled as text link.
- Use when: action should read as contextual/link-like rather than primary button.
- Do not use when: user must clearly notice a primary action.
- Variants:
  - `inline-link-button`
  - tutorial/document links (`tutorial-inline-link`, anchor styles)
- Known examples/files:
  - `src/components/Sidebar.tsx`
  - `src/components/OnboardingTutorialModal.tsx`
  - `src/index.css` (`.inline-link-button`)
- Status: `exception`

Exception policy:
- Keep as exception when visual intent is contextual/link-like and intentionally lower emphasis than ActionButton.
- Do not migrate to ActionButton unless the control should read as a primary/standard command.

### Icon-only Utility Controls
- Role: icon-only actions (close, compact utility icons, icon-only overlay controls).
- Use when: control is intentionally icon-only and discoverable via aria-label/title.
- Do not use when: action needs readable text label for normal app-flow operations.
- Variants:
  - `inline-action-icon`
  - `map-control-btn-icon`
  - `chart-endpoint-icon`
- Known examples/files:
  - `src/components/InlineCloseIconButton.tsx`
  - `src/components/MapView.tsx`
  - `src/components/AppShell.tsx`
- Status: `mapped only`

Policy:
- Mapped and tracked in gallery for coverage.
- Out of scope for visual convergence in the current pass.
- True map/workspace overlay icon controls are standardized under `ToolButton`; non-overlay icon controls remain mapped-only.

## Notification / Notice Inventory

### Converged now
- AppShell transient/persistent notices now use one unified app-level notification stack (always visible, multi-item, auto/manual dismiss, overflow expand/collapse).
- Existing `publishAppNotice` publication points now route into this unified system.

### Intentional exceptions
- `notification-bell` + `notification-badge` (trigger/badge behavior pattern)
- `map-holiday-note` (seasonal/context-specific content treatment)

### Borderline / defer
- `field-help-error` inline validation text (form-level, not always banner-level)
- domain-specific status tiles (`margin-status`, `terrain-alert`) that encode simulation semantics

Recommended next cleanup pass:
- Migrate remaining standalone notice surfaces (`notification-banner`, selected offline/status blocks) onto the same notification container language where semantics match, while keeping bell/badge and domain tiles as exceptions.

### Specialized Triggers
- Role: controls with distinct meaning and visual behavior that should not be forced into generic button taxonomy.
- Use when: control carries unique domain meaning (account chip, bell/badge trigger, upload label, info tip).
- Do not use when: a standard ActionButton or ToolButton already fits.
- Variants:
  - `user-chip`
  - `notification-bell`
  - `upload-button`
  - `info-tip`
- Known examples/files:
  - `src/components/UserAdminPanel.tsx`
  - `src/components/NotificationsPanel.tsx`
  - `src/components/InfoTip.tsx`
  - `src/index.css`
- Status: `exception`

Exception policy:
- Keep distinct when control communicates a unique role (user chip, badge trigger, upload affordance, info-tip).
- Avoid forcing these into ActionButton/ToolButton unless repeated usage proves a shared family is needed.

### Close Icon Button Primitive
- Role: standardized close affordance for modal/header dismiss actions.
- Use when: explicit close/dismiss icon is needed in modal/header contexts.
- Do not use when: control is a generic action button.
- Variants:
  - `InlineCloseIconButton` (built on `inline-action inline-action-icon`)
- Known examples/files:
  - `src/components/InlineCloseIconButton.tsx`
  - reused across `Sidebar`, `SimulationLibraryPanel`, `UserAdminPanel`, `AppShell`
- Status: `standard`

Exception policy:
- Icon-only close remains a dedicated primitive and is not part of ActionButton family.

## Borderline / Too Early to Standardize
- Sidebar library/filter/editor utility controls with embedded data/edit semantics (for example collaborator candidate row affordances) still need role cleanup.
- Some mixed utility controls remain near ActionButton visually but need one more semantics pass before forced convergence.

Recommendation: keep this glossary compact until ActionButton migration coverage is broader and ToolButton vs ActionButton boundaries are fully settled.

## Migration Coverage Snapshot
- `ActionButton` migrated:
  - `SimulationLibraryPanel`, `MapView` inspector standard actions
  - broad standard actions in `AppShell`, `UserAdminPanel`, and expanded `Sidebar` modal/library flows
  - welcome modal primary actions
- Intentionally separate:
  - `ToolButton` overlay controls
  - `LinkButton`
  - tab controls, selection surfaces
- Mapped-only:
  - icon-only utility controls
- Remaining legacy concentration:
  - a small number of role-ambiguous Sidebar utility affordances
