# Ralph Loop: Add test.txt

## How to work

You are in a Ralph Wiggum loop. One item per iteration. Read the durable state first, then work on exactly one unfinished item, verify it, update state, commit, and emit a promise tag.

## Start

Read these files:
- `.ralph/plan.md` — scope, constraints, completion definition
- `.ralph/items.json` — the item list and runtime contract
- `.ralph/progress.md` — previous iteration handoffs

Inspect the current repo state and git log.

## Choose one item

Pick one unfinished item from `.ralph/items.json`. Use `.ralph/plan.md` prioritization. Ignore any other task list or planner state.

## Work

Do only the work for that item. Follow the item's `steps`.

## Verify

Run every verification gate listed in `runtime_contract.verification_gates`. Do not skip, weaken, or suppress failures.

## Update state

- Set `passes: true` for the completed item in `.ralph/items.json`
- Append one handoff entry to `.ralph/progress.md` with: item description, decisions, changed files, verification results, notes

## Commit

Since `require_commit: true`:

- If no git repo exists, init one: `git init`
- Stage only the files needed for this item plus `.ralph/items.json` and `.ralph/progress.md`
- Do not stage `.ralph/loop.md`
- Commit

## Promise

After all checks pass, progress appended, and commit done:

- If this item was the last unfinished item: emit `<promise>COMPLETE</promise>` on its own line
- Otherwise: emit `<promise>NEXT</promise>` on its own line

When the promise tag is emitted, stop. Do not choose or start the next item. Do not plan future work. Do not explain what comes next.

## Boundaries

- Do not edit `.ralph/items.json` `description` or `steps` fields
- Do not delete items
- Do not touch source files outside the scope of the selected item
- Do not run long-running or watcher commands
- Do not use `|| true`, `--no-verify`, output suppression, or anything that masks failures
