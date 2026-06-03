You are executing a Ralph loop iteration in this repository. Work on exactly one unfinished item, prove it, update durable Ralph state, commit, and stop.

Start every invocation by reading these files in order:

1. `.ralph/plan.md`
2. `.ralph/items.json`
3. `.ralph/progress.md`

Ignore PRD/SPEC source files unless `runtime_contract.source_docs` in `.ralph/items.json` lists paths. This bundle is distilled-only, so source docs should be empty. If a source doc is listed in a future revision, treat it as protected secondary evidence and read it only when the selected item needs clarification.

Then inspect recent git history and current repo state. Preserve unrelated working-tree changes. Stage only files needed for the selected Ralph item and required `.ralph/items.json` / `.ralph/progress.md` updates. Do not stage `.ralph/loop.md`.

Choose one unfinished item from `.ralph/items.json` using `.ralph/plan.md` Prioritization Strategy. Treat `.ralph/items.json` as the only authoritative Ralph item list. Ignore secondary task sources, issue queues, TODO files, planner state, chat memory, and harness-local task trackers when choosing Ralph work. You may use a secondary planner or harness-local task tracker only for the already-selected item and never to choose or start another item.

Before editing, revalidate these startup facts when relevant to the selected item:

- The workspace uses pnpm from `package.json`.
- ADR-0002 makes Electron Desktop the only Desktop App. Do not reintroduce SvelteKit/Tauri, Sidecar, Desktop Protocol, or platform-adapter packages.
- Desktop App code under `apps/desktop` must preserve the main/preload/renderer seam. Do not expose broad filesystem/process APIs through preload.
- `packages/pi-sdk-driver` must stay thin over `pi-mono`; reuse pi runtime behavior instead of reimplementing it.
- Desktop UI behavior must be verified on the right Electron surface when the selected item changes visible Desktop App behavior.

Work only on the selected item. Do not implement a second item. If you finish the selected item early, finalize the same iteration only.

Follow these implementation constraints:

- Use the architectural vocabulary from the plan when documenting decisions: Module, Interface, Implementation, Depth, Seam, Adapter, Leverage, Locality.
- Keep changes surgical. Do not refactor adjacent code that is not needed for the selected item.
- Preserve current Codex-style Desktop App behavior unless the selected item explicitly requires a behavior change.
- Do not delete user session history, cached transcripts, screenshots, temp artifacts, or unrelated user changes.
- Do not revive abandoned SvelteKit/Tauri architecture. Removing residue is allowed when proven unused.
- Add or update tests at the same Interface callers use. Do not test private Implementation details unless they are the selected internal seam.

Run every command in `runtime_contract.verification_gates` from `.ralph/items.json` after implementing the selected item. Also run any item-specific tests or smoke commands needed by that item's `steps`. Do not skip checks, weaken tests, use `--no-verify`, append `|| true`, suppress failures, delete tests, or claim success without command evidence.

After verification:

1. Update `.ralph/items.json` only by changing `passes` and `regression_notes` for the selected item when appropriate. Do not edit item descriptions or steps. Do not delete items.
2. Append one entry to `.ralph/progress.md` with:
   - selected item description
   - why this item was chosen
   - changed files
   - verification commands and results
   - decisions made
   - next-iteration notes
3. If `runtime_contract.require_commit` is true, commit after verification and Ralph state updates. If no git repo exists, initialize git in the Ralph workspace root during the first iteration before committing. This repository already has git, so use the existing repository.
4. End with exactly one promise tag on the last non-empty line.

Promise rules:

- Emit `<promise>NEXT</promise>` only after exactly one item moved from `passes:false` to `passes:true`, all required checks passed, progress was appended, protected source docs stayed clean when listed, and the commit requirement was satisfied.
- Emit `<promise>COMPLETE</promise>` only after every item passes and all required checks pass. If COMPLETE only verifies an already-finished bundle, it does not need to append progress.

Terminal boundary rules:

- Treat a valid promise tag as handoff to the loop harness, not as a progress report.
- As soon as the selected item is marked passing in the current invocation, stop implementation work. From that point, only finalize the same iteration.
- Finalizing the same iteration means only: run required verification gates, update `.ralph/items.json`, append `.ralph/progress.md`, satisfy `runtime_contract.require_commit`, verify the commit state when commits are required, and emit the promise tag.
- While finalizing, do not choose another item, plan another item, inspect files for another item, edit source files for another item, update any secondary task tracker for another item, or explain what comes next.
- The final response for a successful one-item iteration must be exactly one promise tag on the last non-empty line.

Use plain execution prose in progress entries. Avoid marketing copy, rhetorical setups, formulaic contrasts, and vague project claims.
