# Health Sweep Report — 2026-06-11

## Summary

**Health score: 74 B** · 99,437 LOC · 524 functions above threshold · 6,544 analyzed

**Verdict: No low-hanging fruit found.** The codebase is already well-structured. High-CC functions use idiomatic patterns (switch on discriminated unions, guard-clause chains with early returns) or contain legitimately complex business logic. Refactoring them would add indirection without reducing real complexity.

---

## What was fixed

### Auto-fixed by fallow

4 unused exports removed via `fallow fix --yes`:

| File | Export | 
|------|--------|
| `apps/desktop/extensions/chassis-reminder.ts` | `default` |
| `apps/desktop/src/composer-layout-renderer.tsx` | `ComposerLayoutLegacyRow` |
| `apps/desktop/src/composer-layout.ts` | `ComposerControlUnitRegistry` |
| `apps/desktop/src/icons.tsx` | `PanelRightIcon` |

Typecheck: ✅ no new errors (2 pre-existing errors unchanged).

### Manual fixes

None. Every candidate was classified as report-only after reading the full function.

---

## Why no code fixes were made

Each top-30 hotspot was read and classified. Here's the breakdown:

| Pattern | Found? | Why not fixed |
|---------|--------|---------------|
| if/else dispatcher → Map lookup | No | All dispatchers already use `switch` on discriminated unions — the idiomatic TS pattern. Converting to Map loses exhaustive checking. |
| Ternary/version cascade → Set | No | No version cascades found in top 30. |
| Large JSX → extract child component | Yes (many) | Every large JSX component has deeply coupled state/callbacks. Extracting risks breaking render invariants. Needs human judgment per component. |
| Repeated `??` merges → helper | Borderline | `mergePersistedState` (CC 22, 36 LOC) has 20 `??` ops, but each maps a different key with different fallback logic. A generic helper would obscure the data flow. |
| Fat method → coordinator + sub-methods | Yes | `sendUserMessage`, `submitComposer` have coupled try/catch/finally blocks where splitting breaks error recovery invariants. |
| Mechanical CC → early returns | No | All guard-clause chains already use early returns. CC is high because of many independent conditions, not nesting. |

---

## Needs review — Complexity hotspots (top 10 by CRAP)

| # | File | Function | CC | Cog | Lines | CRAP | Diagnosis | Why not auto-fixed |
|---|------|----------|-----|-----|-------|------|-----------|-------------------|
| 1 | `src/App.tsx` | `App` | 207 | 180 | 2713 | 43056 | **Real** | Monolithic component. Needs phased extraction into 5-8 sub-components with isolated state. Massive effort. |
| 2 | `src/timeline-item.tsx:211` | `<arrow>` (memo comparator) | 52 | 73 | 75 | 2756 | **Mechanical** | Linear chain of `if (prev.X !== next.X) return false`. CC is high because of many independent equality checks, not branching. Already optimal structure — each check is a one-liner guard. Extracting a helper wouldn't reduce CC. |
| 3 | `src/automations-view.tsx` | `AutomationForm` | 44 | 32 | 331 | 1980 | **Real** | Large form with many fields and conditional validation. Extract sub-forms per section. |
| 4 | `src/timeline-model.ts` | `applySessionEventToTimeline` | 37 | 40 | 159 | 41.6 | **Mechanical** | Switch on 15 `SessionDriverEvent` types. Idiomatic discriminated union dispatch. Each case has distinct logic (retry handling, tool metrics, run completion). Converting to Map loses TS exhaustiveness. |
| 5 | `packages/pi-sdk-driver/src/session-supervisor.ts` | `mapAgentEvent` | 36 | 43 | 152 | 315.9 | **Mechanical** | Switch on `AgentSessionEvent` types mapping to driver events. Same pattern as #4. |
| 6 | `src/project-map-popover.tsx` | `ProjectMapPopover` | 35 | 35 | 179 | 1260 | **Real** | Tree rendering with conditional node types. Extract node renderers per type. |
| 7 | `src/commit-push-button.tsx` | `CommitPushButton` | 34 | 31 | 212 | 1190 | **Real** | Git status + commit flow with many states. Extract status display and action handlers. |
| 8 | `src/sidebar.tsx` | `ThreadSessionRow` | 34 | 31 | 103 | 1190 | **Real** | Session row with conditional rendering based on status/mode. Extract sub-components per status. |
| 9 | `src/environment-widget.tsx` | `EnvironmentPanel` | 33 | 33 | 448 | 1122 | **Real** | Large panel with environment variable editing. Extract editor sections. |
| 10 | `src/subagent-session-converter.ts` | `subagentEntriesToTranscript` | 32 | 70 | 83 | 1056 | **Real** | Complex parser with type narrowing. CC is high because of null/type guards, but structure is linear. Could extract `parseMessageParts()` helper. |

**Key insight:** The top 2 are mechanical — CC inflates from many independent conditions, not bad structure. The rest (#3, #6-10) are real complexity that needs component/function extraction with human judgment on boundaries.

---

## Needs review — Large functions (top 10 by LOC)

| # | File | Function | LOC | Extraction candidate |
|---|------|----------|-----|---------------------|
| 1 | `src/App.tsx` | `App` | 2713 | Split into `AppShell`, `MainContent`, `SessionView`, `DialogManager` |
| 2 | `electron/main.ts` | `<arrow>` | 940 | Extract IPC handlers into separate modules by domain |
| 3 | `src/settings-actions-section.tsx` | `SettingsActionsSection` | 595 | Extract per-section components (danger zone, data management, etc.) |
| 4 | `src/sidebar.tsx` | `WorkspaceGroupContent` | 505 | Extract workspace list item, session list, group header |
| 5 | `src/session-composer.tsx` | `SessionComposer` | 487 | Extract attachment handling, model onboarding, draft management |
| 6 | `src/extensions-view.tsx` | `ExtensionsView` | 453 | Extract extension card, settings panel, marketplace section |
| 7 | `src/environment-widget.tsx` | `EnvironmentPanel` | 448 | Extract variable row, section header, bulk actions |
| 8 | `src/model-selector.tsx` | `ModelSelector` | 435 | Extract provider section, model card, search/filter |
| 9 | `src/hooks/use-timeline-scroll.ts` | `useTimelineScroll` | 434 | Extract scroll tracking, auto-scroll logic, intersection observer |
| 10 | `src/composer-layout-editor.tsx` | `ComposerLayoutEditor` | 424 | Extract drag handle, control unit, layout preview |

---

## Needs review — Circular dependencies

**None found.** ✅

---

## Needs review — Coverage gaps (top 10 untested files by risk)

| # | File | Risk | Fan-in | Why risky |
|---|------|------|--------|-----------|
| 1 | `electron/app-store.ts` | >999 | 2 | Core state management, 22 CC `mergePersistedState`, 0% coverage |
| 2 | `electron/app-store-composer.ts` | >999 | 2 | Composer submit logic, CC 28, 0% coverage |
| 3 | `electron/app-store-worktree.ts` | >999 | 1 | Worktree creation, CC 28, 0% coverage |
| 4 | `electron/app-store-subagent.ts` | >999 | 1 | Subagent management, 0% coverage |
| 5 | `electron/app-store-timeline.ts` | >999 | 1 | Timeline event handling, 0% coverage |
| 6 | `electron/app-state-reducer.ts` | >999 | 4 | State reducer, CC 41, 0% coverage |
| 7 | `packages/pi-sdk-driver/src/session-supervisor.ts` | >999 | 3 | Session lifecycle, CC 36, 0% coverage |
| 8 | `src/timeline-model.ts` | >999 | 6 | Timeline event processing, CC 37, 0% coverage |
| 9 | `src/subagent-session-converter.ts` | >999 | 1 | Transcript parsing, CC 32, 0% coverage |
| 10 | `src/hooks/use-keyboard-shortcuts.ts` | >999 | 1 | Keyboard handling, 4 complex fns, 0% coverage |

---

## Needs review — Dead code summary

| Category | Count | Status |
|----------|-------|--------|
| Unused exports | 4 | ✅ Auto-fixed |
| Unused dependencies | 0 | ✅ Clean |
| Unused enum members | 0 | ✅ Clean |
| Circular dependencies | 0 | ✅ Clean |

---

## Recommended next steps

### 1. Extract `App` component (effort: high, impact: highest)
**File:** `src/App.tsx` — CC 207, 2713 LOC, CRAP 43056

The single largest hotspot by every metric. Split into:
- `AppShell` — top-level layout, dialog manager
- `SessionView` — thread/conversation rendering
- `GlobalOverlays` — toasts, modals, popovers
- Move session-level state into `useSessionState` hook

**Approach:** Extract one section at a time, typecheck after each. Start with dialog/modal rendering (lowest coupling).

### 2. Add tests for `app-state-reducer.ts` (effort: low, impact: high)
**File:** `electron/app-state-reducer.ts` — CC 41, 0% coverage, 4 fan-in

Pure function with no I/O — trivially testable. Every `DesktopAction` type maps to a deterministic state transition. Adding tests here de-risks all future reducer changes and drops CRAP dramatically (the `(1 - coverage)³` term).

**Approach:** Write a test per action type. Use property-based testing for `setPropIfChanged` cases.

### 3. Extract `AutomationForm` sub-forms (effort: medium, impact: medium)
**File:** `src/automations-view.tsx` — CC 44, 331 LOC

Large form with many conditional fields. Extract:
- Trigger config section
- Action config section  
- Schedule/recurring settings

**Approach:** Identify field groups by trigger type, extract each into a controlled component.

### 4. Add tests for `session-supervisor.ts` (effort: medium, impact: high)
**File:** `packages/pi-sdk-driver/src/session-supervisor.ts` — CC 36, 3 fan-in, 0% coverage

Core session lifecycle management. The `mapAgentEvent` and `sendUserMessage` functions are well-structured switches that are easy to unit-test with mock records.

**Approach:** Test `mapAgentEvent` with each event type → expected driver events. Test `sendUserMessage` happy path + error recovery.

### 5. Extract `subagentEntriesToTranscript` parser helpers (effort: low, impact: low)
**File:** `src/subagent-session-converter.ts` — CC 32, cognitive 70, 83 LOC

Highest cognitive-to-LOC ratio in the codebase. The inner loop parses 3 message types with type narrowing. Extract:
- `parseToolResult(entry, toolIndex)` 
- `parseAssistantParts(parts, idBase)`
- `parseUserMessage(content, idBase)`

**Approach:** Pure functions, easy to test. Low risk, low effort, improves readability.

---

*Generated by fallow health sweep + manual analysis. Run `fallow health --coverage <coverage-final.json>` for exact CRAP scores.*
