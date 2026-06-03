# Execution Plan: Add a text file saying "test"

## Source Inputs

User request: add one text file with content "test" to this repo.

## Objective

Create a single file containing "test" in the workspace root. Init git so Ralph can commit.

## Scope In

- Init git repo if not present
- Write `test.txt` with content "test"
- Commit the file
- Verify file exists with correct content

## Scope Out

- No app code changes, no package edits, no config changes
- No build, test, or typecheck verification
- No multi-file structure

## Constraints

- File content must be exactly "test" (no trailing newline unless unavoidable)
- File must exist at workspace root

## Prioritization Strategy

One item. No ordering needed.

## Completion Definition

All items in `.ralph/items.json` have `passes: true`.
