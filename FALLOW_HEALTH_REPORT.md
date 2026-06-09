# Fallow Health Sweep Report

**Date:** 2026-06-09
**Score:** 76 B (down from initial — hotspots -10, unit size -10, circular deps -1.5, coupling -1.2, duplication -1.1)

---

## What Was Fixed

### 1. `parseSubagentAgentFile` — ternary cascade → validator helper
**File:** `apps/desktop/electron/app-store-subagent.ts`

Extracted `parseBoolField()` helper to replace 4 identical boolean ternary cascades:
```ts
// Before (×4):
...(fields.get("enabled") === "true" ? { enabled: true } : fields.get("enabled") === "false" ? { enabled: false } : {})

// After:
const enabled = parseBoolField(fields, "enabled");
...(enabled !== undefined ? { enabled } : {})
```

| Metric | Before | After |
|--------|--------|-------|
| Cyclomatic | 29 | 25 |
| Cognitive | 32 | 24 |
| CRAP | 870 | 650 |

### 2. `getDesktopCommandFromShortcut` — already fixed (pre-existing)
**File:** `apps/desktop/src/ipc.ts`

Another agent already converted the if/return dispatcher chain (CC 26) into a `shortcutTable` array lookup (CC ~3). No action needed — confirmed present and typechecks clean.

### Auto-fixed by fallow
- 0 dead exports removed
- 0 unused deps removed
- 0 unused enum members removed
- `fallow fix --yes` fixed 0 issues

---

## Needs Review — Complexity Hotspots (Top 10 by CRAP)

| # | File | Function | CC | Cog | LOC | CRAP | Diagnosis | Why not auto-fixed |
|---|------|----------|----|----|-----|------|-----------|-------------------|
| 1 | `App.tsx` | `App` | 188 | 167 | 2431 | 35532 | **Real** — massive React component with deep state coupling | Effort:high, needs full decomposition into child components |
| 2 | `timeline-item.tsx` | `<arrow>` (inline) | 52 | 73 | 75 | 2756 | **Mechanical** — per-kind equality checkers, already uses Map dispatch | CC lives in checker functions, not dispatch; splitting checkers is low-risk but low-value |
| 3 | `app-state-reducer.ts` | `reduce` | 53 | 43 | 199 | 62.5 | **Mechanical** — 13 identical settings cases (`if state.X===action.X return state; bump`) | TS discriminated unions make generic helper type-unsafe; needs `as never` casts |
| 4 | `timeline-item.tsx` | `isSameTimelineItem` | 53 | 57 | 62 | 2862 | **Mechanical** — already uses `timelineItemEquality` object dispatch | CC is in checker functions (loops + field comparisons), not dispatch pattern |
| 5 | `timeline-model.ts` | `applySessionEventToTimeline` | 37 | 40 | 159 | 41.6 | **Real** — event-type switch with per-type state transforms | Critical path, 0% test coverage, 5 fan-in |
| 6 | `composer-panel.tsx` | `ComposerPanel` | 37 | 38 | 260 | 1406 | **Real** — React component with conditional rendering + callbacks | Extractable sub-components, but 14 fan-out means cascading imports |
| 7 | `commit-push-button.tsx` | `CommitPushButton` | 35 | 41 | 207 | 1260 | **Real** — git status polling + branch/PR state machine | Zero test coverage, 4 fan-out |
| 8 | `project-map-popover.tsx` | `ProjectMapPopover` | 35 | 35 | 179 | 1260 | **Real** — graph rendering + filter state | 3 fan-out, low coupling risk |
| 9 | `subagent-session-converter.ts` | `subagentEntriesToTranscript` | 32 | 70 | 83 | 1056 | **Real** — entry-type switch with nested transforms | High cognitive (70) despite low LOC — deeply nested logic |
| 10 | `session-supervisor.ts` | `mapAgentEvent` | 32 | 33 | 139 | 253.2 | **Real** — event-type switch with per-type mapping | Critical path in pi-sdk-driver, 3 fan-in |

### Key observations
- **Most CRAP is real, not mechanical.** The mechanical ones (reducer, isSameTimelineItem) are already dispatched via Maps/objects — the CC lives in per-case logic, not dispatch pattern.
- **Zero test coverage** on all top-10 hotspots. CRAP scores are inflated by the `(1 - cov)³` term. Adding even basic tests would drop CRAP dramatically without touching code.
- **`App` at 35532 CRAP** dominates everything. It's a 2431-line React component. No single refactor fixes it — needs systematic child-component extraction over multiple PRs.

---

## Needs Review — Large Functions (Top 10 by LOC)

| # | File | Function | LOC | CC | Extraction candidate? |
|---|------|----------|-----|----|-----------------------|
| 1 | `App.tsx` | `App` | 2431 | 188 | Yes — split into `AppShell`, `SessionView`, `SettingsView` wrapper |
| 2 | `main.ts` | `<arrow>` (IPC handler) | 748 | — | Yes — split IPC channel registrations into domain modules |
| 3 | `session-composer.tsx` | `SessionComposer` | 479 | — | Yes — extract `ComposerToolbar`, `ComposerInput`, `ComposerFooter` |
| 4 | `extensions-view.tsx` | `ExtensionsView` | 453 | 27 | Yes — extract `ExtensionCard`, `ExtensionSearch` |
| 5 | `model-selector.tsx` | `ModelSelector` | 435 | 31 | Yes — extract `ModelDropdown`, `ThinkingDial` (9 fan-in amplifies changes) |
| 6 | `use-timeline-scroll.ts` | `useTimelineScroll` | 434 | — | Maybe — scroll logic is inherently sequential |
| 7 | `tree-modal.tsx` | `TreeModal` | 407 | 28 | Yes — extract `TreeSearchBar`, `TreeRow`, `TreeSummary` |
| 8 | `conversation-timeline.tsx` | `ConversationTimeline` | 374 | 31 | Yes — extract `TimelineHeader`, `TimelineStream` |
| 9 | `sidebar.tsx` | `Sidebar` | 357 | — | Yes — extract `WorkspaceSwitcher`, `SessionList` |
| 10 | `settings-view.tsx` | `SettingsView` | 351 | — | Yes — already has section components, but parent is still large |

---

## Needs Review — Circular Dependencies

**1 cycle found:**
```
conversation-timeline.tsx
  → timeline-item.tsx
    → subagent-card.tsx
      → subagent-session-panel.tsx
        → conversation-timeline.tsx
```

**Fix:** Extract shared types (e.g., `TimelineRow`, `SubagentCardProps`) into a types-only module. The cycle is type-level, not runtime — likely exists because of inline type imports crossing the boundary.

---

## Needs Review — Coverage Gaps (Top 10 by risk)

| # | File | LOC | Fan-in | Risk | Notes |
|---|------|-----|--------|------|-------|
| 1 | `app-store.ts` | — | 2 | high | Core state store, 93 commits, 8704 churn |
| 2 | `app-store-composer.ts` | — | 2 | high | `submitComposer` (CC 28), 0% coverage |
| 3 | `app-store-internals.ts` | — | — | high | Internal store methods |
| 4 | `app-store-subagent.ts` | — | — | high | `parseSubagentAgentFile` (CC 25), 0% coverage |
| 5 | `app-store-persistence.ts` | — | 2 | high | `writePersistedUiState`, 0% coverage |
| 6 | `app-store-diff.ts` | — | — | high | Git diff operations, 0% coverage |
| 7 | `app-store-files.ts` | — | — | high | Workspace file listing, 0% coverage |
| 8 | `app-store-ralph.ts` | — | — | high | Loop transcript loading, 0% coverage |
| 9 | `app-store-review.ts` | — | — | high | Review operations, 0% coverage |
| 10 | `app-store-workspace.ts` | — | — | high | Workspace management, 0% coverage |

**Pattern:** The entire `electron/app-store*.ts` layer has 0% test coverage. These are the most-changed files (hotspots) and the most complex (high CC).

---

## Recommended Next Steps

### 1. **Extract `App` into child components** (effort: high, impact: very high)
The 2431-line `App` component at CC 188 is the #1 hotspot by every metric. Strategy:
- Identify the 5-6 major JSX branches (session view, settings, new thread, etc.)
- Extract each into a named child component, moving relevant state + callbacks with it
- Target: `App` drops to <200 LOC coordinator, each child <300 LOC
- **Risk:** 55 fan-out means import changes cascade. Do one child at a time, typecheck after each.

### 2. **Add tests for `app-store*.ts`** (effort: medium, impact: high)
The entire Electron store layer has 0% coverage. Adding unit tests for `reduce`, `submitComposer`, and `parseSubagentAgentFile` would:
- Drop CRAP scores dramatically (the `(1 - cov)³` term)
- De-risk future refactoring of these critical-path functions
- Start with `reduce` — pure function, easy to test, CC 53

### 3. **Break the circular dependency** (effort: low, impact: medium)
Extract shared types from `conversation-timeline.tsx → timeline-item.tsx → subagent-card.tsx → subagent-session-panel.tsx → conversation-timeline.tsx` into a `timeline-types.ts` module. 1-hour fix.

### 4. **Refactor `reduce` settings cases** (effort: low, impact: medium)
13 of 20 switch cases follow identical pattern. A type-safe helper using `as never` casts would cut CC 53→~20. Test first (see #2), then refactor.

### 5. **Extract IPC domain modules from `main.ts`** (effort: medium, impact: medium)
The 748-line arrow function in `main.ts` registers all IPC channels. Split into `ipc-session.ts`, `ipc-workspace.ts`, `ipc-settings.ts` etc. Each becomes independently testable.
