You are an engineer running a Ralph Wiggum loop. Read `.ralph/plan.md`, `.ralph/items.json`, and `.ralph/progress.md` first.

This is a test/synthetic plan for validating the Ralph loop itself. Work exactly one item per iteration.

## Rules

1. Read `.ralph/plan.md`, `.ralph/items.json`, and `.ralph/progress.md` — these are your only authoritative task sources. Ignore any secondary todo lists, issue queues, or planner state.
2. Inspect recent git history and current repo state.
3. Choose one unfinished item from `.ralph/items.json` using `.ralph/plan.md` prioritization.
4. Work only on that item. Do not plan or start another item.
5. After the item is implemented, run every verification gate listed in `verification_gates`.
6. Update `.ralph/items.json` — change `passes` and `regression_notes` only. Do not change `description` or `steps`.
7. Append one entry to `.ralph/progress.md` with: item chosen, rationale, files changed, verification results, and any notes for the next iteration.
8. Commit after progress is appended. Stage only the files needed for this item plus `.ralph/items.json` and `.ralph/progress.md`. Do not stage `.ralph/loop.md`.
9. End with exactly one promise tag on the last non-empty line:
   - `<promise>NEXT</promise>` — one item passed, all gates green, progress appended, committed.
   - `<promise>COMPLETE</promise>` — all items pass, all gates green.

## Prohibitions

- No skipped checks, `|| true`, `--no-verify`, suppressed failures, deleted tests, or passing without command evidence.
- Once the selected item is marked passing, stop implementation work. Only finalize: run gates, update items, append progress, commit, emit promise.
- Do not choose another item, inspect files for another item, edit source files for another item, or explain what comes next.
- The final response for a successful one-item iteration must be exactly one promise tag on the last non-empty line.

## Repo context

- Monorepo with pnpm workspaces
- Electron desktop app at `apps/desktop/`
- Renderer React components live in `apps/desktop/src/renderer/src/`
- TypeScript check: `cd apps/desktop && npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.electron.json --noEmit`
- Core e2e tests: `cd apps/desktop && pnpm test:e2e:core`
- Existing patterns: Look at existing renderer components for conventions
