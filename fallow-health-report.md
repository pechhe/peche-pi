# Fallow Health Report — 2026-06-09

## What was fixed

### 1. `reduce` in `apps/desktop/electron/app-state-reducer.ts`

**Pattern:** 10 identical "set-if-changed" cases each doing `if (state.X === action.X) return state; return bump({...state, X: action.X})`.

**Fix:** Extracted `setPropIfChanged<K>()` helper. Each case is now one line: `return setPropIfChanged(state, "key", action.value)`.

| Metric | Before | After | Δ |
|--------|--------|-------|---|
| Cyclomatic | 53 | 40 | -13 (-25%) |
| Cognitive | 43 | 17 | -26 (-60%) |
| Lines | 199 | 147 | -52 (-26%) |
| CRAP | 62.5 | 45.4 | -17 (-27%) |
| Severity | CRITICAL | HIGH | ↓ |

Dropped from #3 to out of top-10 complexity list.

### 2. `handleKeyDown` in `apps/desktop/src/hooks/use-keyboard-shortcuts.ts`

**Pattern:** 7 inline if-blocks for digit keys (1-4), arrow keys, and bracket keys — all after the existing `modKeyMap` lookup already handled letter shortcuts.

**Fix:** Added entries for `1`, `2`, `3`, `4`, `ArrowUp`, `ArrowDown`, `[`, `]` to the existing `modKeyMap`. Removed 30 lines of inline dispatch code.

| Metric | Before | After | Δ |
|--------|--------|-------|---|
| Cyclomatic | 27 | 18 | -9 (-33%) |
| Cognitive | 48 | 23 | -25 (-52%) |
| Lines | 100 | 59 | -41 (-41%) |
| CRAP | 756 | 342 | -414 (-55%) |
| Severity | CRITICAL | CRITICAL | — (CRAP still high due to fan-out) |

### 3. `getDesktopCommandFromShortcut` in `apps/desktop/src/ipc.ts`

**Skipped** — already refactored to `shortcutTable` pattern by a previous pass.

### 4. `isSameTimelineItem` in `apps/desktop/src/timeline-item.tsx`

**Skipped** — already refactored to `timelineItemEquality` Map by a previous pass. Function is now 4 lines.

---

## Auto-fixed by fallow

`fallow fix --dry-run` reported: **No files were modified.** No dead exports, unused deps, or unused enum members detected.

---

## Needs review — Complexity hotspots (top 10 by CRAP)

| # | File | Function | CC | Cog | Lines | CRAP | Diagnosis | Why not fixed |
|---|------|----------|----|-----|-------|------|-----------|---------------|
| 1 | `App.tsx` | `App` | 188 | 167 | 2431 | 35532 | **Real** — massive component, deeply coupled | Needs full decomposition, not mechanical |
| 2 | `timeline-item.tsx` | `<arrow>` memo | 52 | 73 | 75 | 2756 | **Real** — discriminated union comparator with variant-specific expansion/streaming checks | Inherent complexity; already uses `isSameTimelineItem` Map |
| 3 | `timeline-model.ts` | `applySessionEventToTimeline` | 37 | 40 | 159 | 41.6 | **Real** — 12 event types, each with unique state mutation | Business logic; splitting risks breaking event ordering |
| 4 | `composer-panel.tsx` | `ComposerPanel` | 37 | 38 | 260 | 1406 | **Real** — JSX with many conditional branches | Needs child component extraction with state |
| 5 | `commit-push-button.tsx` | `CommitPushButton` | 35 | 41 | 207 | 1260 | **Real** — complex git/UI state machine | Coupled to git operations, risky without tests |
| 6 | `project-map-popover.tsx` | `ProjectMapPopover` | 35 | 35 | 179 | 1260 | **Real** — tree rendering with search/filter | Self-contained; could extract sub-components |
| 7 | `subagent-session-converter.ts` | `subagentEntriesToTranscript` | 32 | 70 | 83 | 1056 | **Real** — deeply nested type-guard parsing | Tool-result completion logic is fragile |
| 8 | `session-supervisor.ts` | `mapAgentEvent` | 32 | 33 | 139 | 253.2 | **Real** — runtime event mapping | Critical path, zero test coverage |
| 9 | `topbar.tsx` | `Topbar` | 32 | 29 | 286 | 1056 | **Mechanical** — many conditional UI sections | Could extract popover/panel children |
| 10 | `model-selector.tsx` | `ModelSelector` | 31 | 41 | 435 | 992 | **Real** — complex model/provider selection logic | 9 dependents amplify any signature change |

---

## Needs review — Large functions (top 10 by LOC)

| # | File | Function | Lines | Extraction candidate |
|---|------|----------|-------|---------------------|
| 1 | `App.tsx` | `App` | 2431 | Yes — extract sidebar, topbar, main panel into children |
| 2 | `main.ts` | `<arrow>` | 748 | Yes — IPC handler registration table |
| 3 | `session-composer.tsx` | `SessionComposer` | 479 | Medium — slash menu + attachment logic |
| 4 | `extensions-view.tsx` | `ExtensionsView` | 453 | Yes — extension card component |
| 5 | `model-selector.tsx` | `ModelSelector` | 435 | Medium — slider vs dropdown split |
| 6 | `use-timeline-scroll.ts` | `useTimelineScroll` | 434 | No — linear scroll logic, low branching |
| 7 | `tree-modal.tsx` | `TreeModal` | 407 | Yes — search bar + tree view + summary step |
| 8 | `conversation-timeline.tsx` | `ConversationTimeline` | 374 | Medium — streaming vs static rendering |
| 9 | `sidebar.tsx` | `Sidebar` | 357 | Yes — workspace group + chat group components |
| 10 | `settings-view.tsx` | `SettingsView` | 351 | Yes — per-section child components |

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

Fix: Extract shared types/interfaces into a separate module, or use dynamic imports for the cycle edge.

---

## Needs review — Coverage gaps (top 10 untested files by risk)

| File | Risk | Why |
|------|------|-----|
| `app-store-composer.ts` | High | 12 untested re-exports, submit logic |
| `app-store-diff.ts` | High | Git diff operations, 6 untested exports |
| `app-store-files.ts` | High | File listing, workspace file ops |
| `app-store-internals.ts` | High | Core state management |
| `app-store-ralph.ts` | High | Loop transcript loading |
| `app-store-review.ts` | High | Review state management |
| `app-store-subagent.ts` | High | Subagent lifecycle |
| `app-store-workspace.ts` | High | Workspace operations |
| `app-store-worktree.ts` | High | Git worktree management |
| `app-store.ts` | High | Main store, 93 commits, 8704 churn |

Total: **164 untested files**, 390 untested exports, **21.9% file coverage**.

---

## Recommended next steps

### 1. Extract `App` into child components (Effort: High, Impact: Critical)
`App.tsx` at 2431 lines / CC 188 / CRAP 35532 is the single biggest risk. Extract:
- Sidebar region → `<AppSidebar />`
- Top bar → `<AppTopbar />`
- Main content area → `<AppMainContent />`
- Dialog/modal layer → `<AppModals />`

Each child gets its own props slice. The parent becomes a thin orchestrator. **Approach:** Start with the modal/dialog layer (lowest coupling), then sidebar, then main content.

### 2. Add tests for `app-state-reducer.ts` (Effort: Low, Impact: High)
The reducer is pure, 147 lines, zero test coverage. Each case is independently testable. The new `setPropIfChanged` helper makes property-setter tests trivial. **Approach:** Table-driven tests — one assertion per action type.

### 3. Break the circular dependency (Effort: Low, Impact: Medium)
Extract the shared types between `conversation-timeline.tsx` and `subagent-session-panel.tsx` into a `timeline-types.ts` module. **Approach:** Move `TranscriptMessage` and related types to the new module, update imports.

### 4. Extract `Topbar` popover children (Effort: Medium, Impact: Medium)
`Topbar` (CC 32, 286 lines) has multiple conditional popover/panel sections. Extract each into a named child component. Mechanical, low-risk.

### 5. Add coverage for `session-supervisor.ts` critical path (Effort: Medium, Impact: High)
`mapAgentEvent` (CC 32) and `sendUserMessage` (CC 26) are on the critical runtime path with zero coverage. **Approach:** Mock the session driver, test event→transcript mapping for each event type.
