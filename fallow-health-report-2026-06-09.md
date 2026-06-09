# Fallow Health Sweep — 2026-06-09

## Health Score: 74 B (unchanged from baseline — fixes were surgical)

---

## What was fixed

### Complexity reductions (3 refactors)

| File | Function | What changed | CC before → after | CRAP before → after |
|------|----------|-------------|-------------------|---------------------|
| `apps/desktop/src/hooks/use-slash-menu.tsx` | `applySlashOptionSelection` | Extracted `applyOptionWithApi` helper — 4 identical branches (model/thinking/login/logout) now share one code path with callback + API thunk params | 23 → 10 | 552 → 110 |
| `apps/desktop/src/tree-modal.tsx` | `handleKeyDown` | Merged ArrowDown/ArrowUp into one branch with direction variable; merged ArrowLeft/ArrowRight into one branch with `expanded === (key === "ArrowLeft")` guard | 24 → 20 | 600 → 420 |
| `apps/desktop/src/hooks/use-keyboard-shortcuts.ts` | `handleCommand` | Converted 7-branch if/else dispatcher to `Map<PiDesktopCommand, () => boolean>` lookup. Function now 3 lines. Dropped out of top 501 complexity list entirely. | 7 → ~1 | N/A (was below threshold) |

### Auto-fixed by fallow (dead code removal)

**Unused exports removed (10):**

| File | Export | Notes |
|------|--------|-------|
| `apps/desktop/electron/update-checker.ts` | `getUpdateState` | Only used internally via `onUpdateStateChange` |
| `apps/desktop/src/desktop-state.ts` | `nextAutomationRun` | Helper only called by `countAutomationsNext24h` in same file |
| `apps/desktop/electron/plan-orchestrator.ts` | `getActiveOrchestratorIds` | No consumers found |
| `apps/desktop/src/thread-types.ts` | `threadTypeMeta` | Only used internally by `getThreadTypeHue` |
| `apps/desktop/src/thread-types.ts` | `ALL_THREAD_TYPES` | No consumers found |
| `apps/desktop/electron/plan-parser.ts` | `parsePlanMarkdown` | 4 exports — no external consumers |
| `apps/desktop/electron/plan-parser.ts` | `readIssueFiles` | " |
| `apps/desktop/electron/plan-parser.ts` | `parseIssueFile` | " |
| `apps/desktop/electron/plan-parser.ts` | `listPlans` | " |
| `apps/desktop/src/timeline-item.tsx` | `collectAllUndoOps` | Only `buildTurnUndoOpsMap` used externally |

**Unused dependency removed (1):**
- `@tanstack/react-virtual` from `apps/desktop/package.json`

**All typechecks pass** (`tsconfig.json` renderer, `tsconfig.electron.json` main, `packages/pi-sdk-driver`).

---

## Needs review — Complexity hotspots (top 10 by CRAP)

| # | File | Function | CC | Cognitive | Lines | CRAP | Diagnosis | Why not auto-fixed |
|---|------|----------|----|-----------|-------|------|-----------|--------------------|
| 1 | `App.tsx` | `App` | 188 | 167 | 2431 | 35532 | **Real** — massive component with nested routing, session lifecycle, extension loading, graph integration. Every feature adds branches. | Too risky without full E2E coverage. Needs decomposition into 5-8 child components (routing, session-init, extension-loading, graph, etc.) |
| 2 | `timeline-item.tsx` | `<arrow>` (memo comparator) | 52 | 73 | 75 | 2756 | **Mechanical** — 20+ prop equality checks in sequence. Each `if (prev.X !== next.X) return false` is 1 CC. | Splitting adds indirection for zero readability gain. The comparator is correct and exhaustive. |
| 3 | `timeline-item.tsx` | `isSameTimelineItem` | 53 | 57 | 62 | 2862 | **Mechanical** — already table-driven (`timelineItemEquality` map). High CC from per-kind comparison functions. | Already uses the recommended pattern. Per-kind comparators are inherently complex. |
| 4 | `app-state-reducer.ts` | `reduce` | 53 | 43 | 199 | 62.5 | **Mechanical** — flat switch on 25 action types, each case is 1-3 lines of `setPropIfChanged` or `burn({...state, ...})`. | Map lookup won't help — each case has different payload shape. CC = number of cases, not branching depth. |
| 5 | `timeline-model.ts` | `applySessionEventToTimeline` | 37 | 40 | 159 | 41.6 | **Real** — handles 12+ session event types with nested state mutations. Deeply coupled to timeline data model. | Critical path, zero unit coverage. Refactoring risks breaking transcript rendering. |
| 6 | `composer-panel.tsx` | `ComposerPanel` | 37 | 38 | 260 | 1406 | **Real** — conditional rendering based on composer mode, runtime state, session status. Many props. | High fan-in (2 dependents). Extract child components for mode-specific panels. |
| 7 | `commit-push-button.tsx` | `CommitPushButton` | 35 | 41 | 207 | 1260 | **Real** — git state machine (clean/dirty/ahead/behind/diverged) × UI states (idle/loading/success/error). | Needs state machine extraction, not just Map lookup. |
| 8 | `project-map-popover.tsx` | `ProjectMapPopover` | 35 | 35 | 179 | 1260 | **Real** — graph visualization + search + filtering + selection. | Self-contained component, low fan-in. Extract search/filter logic. |
| 9 | `subagent-session-converter.ts` | `subagentEntriesToTranscript` | 32 | 70 | 83 | 1056 | **Real** — highest cognitive/CC ratio in top 10. Deeply nested transformation of subagent entries into transcript format. | High cognitive = genuinely hard to understand. Needs step-by-step decomposition with tests first. |
| 10 | `session-supervisor.ts` | `mapAgentEvent` | 32 | 33 | 139 | 253.2 | **Real** — maps 15+ agent event types to internal format. Each type has different payload. | Critical path in pi-sdk-driver. High churn (50 commits/6mo). Needs integration tests before refactoring. |

---

## Needs review — Large functions (top 10 by LOC)

| # | File | Function | Lines | Extraction candidates |
|---|------|----------|-------|-----------------------|
| 1 | `App.tsx` | `App` | 2431 | Split into: `AppRouter`, `SessionLifecycle`, `ExtensionLoader`, `GraphIntegration`, `AppShell` |
| 2 | `main.ts` | `<arrow>` (main process setup) | 748 | Extract IPC handler registration, window management, tray/menu setup |
| 3 | `session-composer.tsx` | `SessionComposer` | 479 | Extract `ComposerToolbar`, `ComposerInput`, `ComposerModeSwitch` |
| 4 | `extensions-view.tsx` | `ExtensionsView` | 453 | Extract `ExtensionList`, `ExtensionDetail`, `ExtensionConfig` |
| 5 | `model-selector.tsx` | `ModelSelector` | 435 | Extract `ModelSlider`, `ModelDropdown`, `ThinkingLevelPicker` |
| 6 | `use-timeline-scroll.ts` | `useTimelineScroll` | 434 | Virtualizer + scroll anchoring logic. Could split scroll-state from scroll-actions |
| 7 | `tree-modal.tsx` | `TreeModal` | 421 | Extract `TreeSearch`, `TreeRow`, `TreeSummary` |
| 8 | `conversation-timeline.tsx` | `ConversationTimeline` | 374 | Extract `TimelineHeader`, `TimelineVirtualList`, `TimelineEmpty` |
| 9 | `sidebar.tsx` | `Sidebar` | 357 | Extract `SidebarSearch`, `WorkspaceGroup`, `SessionList` |
| 10 | `use-keyboard-shortcuts.ts` | `useKeyboardShortcuts` | 355 | Already well-structured with maps. Could extract sidebar-nav into own hook. |

---

## Needs review — Circular dependencies

**1 cycle:**

```
conversation-timeline.tsx
  → timeline-item.tsx
    → subagent-card.tsx
      → subagent-session-panel.tsx
        → conversation-timeline.tsx
```

**Fix:** Break the cycle by moving shared types (e.g., `TimelineRow`, `SubagentToolCard` props) into a separate `timeline-types.ts` or `shared.ts` module. The cycle likely exists because `SubagentSessionPanel` renders a `ConversationTimeline` for nested subagent sessions — extract an interface/prop type for the timeline renderer and pass it as a prop instead of importing the component directly.

---

## Needs review — Coverage gaps (top 10 untested files by risk)

| # | File | Fan-in | Churn | Risk | Why it matters |
|---|------|--------|-------|------|----------------|
| 1 | `app-store.ts` | 2 | 8704 | >999 | Central state store. Every feature depends on it. |
| 2 | `app-store-composer.ts` | 2 | 1089 | >999 | Composer submit/queue logic. User-facing. |
| 3 | `app-store-subagent.ts` | 0 | — | >999 | Subagent lifecycle. Complex agent file parsing. |
| 4 | `app-store-diff.ts` | 0 | — | >999 | Git diff operations. Used by commit-push flow. |
| 5 | `app-store-internals.ts` | 0 | — | >999 | Internal state helpers. Used by all app-store-* modules. |
| 6 | `app-store-persistence.ts` | 2 | 552 | >999 | UI state persistence. Data loss if broken. |
| 7 | `app-store-session-state.ts` | 2 | 467 | >999 | Session state management. Core feature. |
| 8 | `session-supervisor.ts` | 3 | 3671 | 253.2 | Session lifecycle. High churn = high risk. |
| 9 | `timeline-model.ts` | 5 | 1024 | 41.6 | Timeline event processing. Transcript rendering depends on it. |
| 10 | `app-state-reducer.ts` | 5 | 374 | 62.5 | State transitions. Mechanical but critical. |

---

## Recommended next steps (ranked by effort × impact)

### 1. Break circular dependency (effort: low, impact: medium)
**Approach:** Move the `ConversationTimeline` render callback out of `SubagentSessionPanel` — pass it as a React prop (`renderTimeline`) instead of importing the component. This eliminates the `conversation-timeline → timeline-item → subagent-card → subagent-session-panel → conversation-timeline` cycle. ~30 min.

### 2. Add unit tests for `app-state-reducer.ts` (effort: low, impact: high)
**Approach:** The `reduce` function is mechanical (25 action types, each 1-3 lines). It's the perfect candidate for snapshot/property testing — generate random actions, verify state transitions. 50 test cases would cover all branches. This de-risks all future reducer changes. ~1-2 hours.

### 3. Extract `App.tsx` child components (effort: high, impact: very high)
**Approach:** `App` is 2431 lines with CC 188. Extract in this order:
- `AppRouter` — view routing logic (~200 lines)
- `SessionLifecycle` — session init/refresh/disposal (~300 lines)
- `ExtensionLoader` — extension discovery and loading (~150 lines)
- `AppShell` — top-level layout (topbar + sidebar + content) (~200 lines)
Each extraction is independently verifiable. ~1-2 days.

### 4. Extract `subagentEntriesToTranscript` decomposition (effort: medium, impact: high)
**Approach:** Highest cognitive complexity (70) relative to size (83 lines). The function transforms subagent entries into transcript messages. Break into: `convertEntryToMessage`, `mergeConsecutiveEntries`, `buildTranscriptMetadata`. Add tests first — the transformation logic is pure and testable. ~2-3 hours.

### 5. State machine for `CommitPushButton` (effort: medium, impact: medium)
**Approach:** The component has CC 35 from git-state × UI-state combinations. Extract a `useCommitPushState` hook that returns `{ state, actions }` using an explicit state machine (clean/dirty/ahead/behind × idle/loading/success/error). The component becomes a pure renderer. ~2-3 hours.
