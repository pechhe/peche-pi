# Ralph Progress

## Iteration 1 — Desktop Protocol package

**Item:** Create the shared Desktop Protocol package with Valibot-validated command, response, event, snapshot, and error envelopes.

**Why chosen:** Prioritization strategy ranks stable contracts and safety boundaries first. The protocol is the seam between Desktop Client and Sidecar; all later items depend on it.

**Changed files:**
- `packages/desktop-protocol/` — new package (committed in d6c02a9)
- `packages/desktop-core/package.json` — added missing `@pi-gui/desktop-protocol` workspace dependency
- `apps/desktop/electron/commit-push-service.ts` — fixed `noUncheckedIndexedAccess` error on array index access
- `.ralph/items.json` — marked item 1 passing
- `.ralph/progress.md` — this file

**Verification:**
- `pnpm --filter @pi-gui/desktop-protocol test`: 17/17 pass
- `pnpm typecheck`: root passes all 8 workspace projects
- `pnpm lint`: no errors

**Decisions:**
- Protocol uses Valibot 1.x pipe-based schemas: client-hello, server-ready, auth-rejected, server-error, command envelopes, event envelopes, and a closed command catalog (workspace, session, composer, model, view, auth).
- Fixed two unrelated gate blockers: desktop-core missing the protocol workspace dep, and commit-push-service.ts tripping `noUncheckedIndexedAccess` on array indexing.

**Next-iteration notes:** Item 2 (Sidecar runtime compatibility probe) is next per prioritization strategy: runtime compatibility and process lifecycle after stable contracts. The desktop-core and commit-push-service fixes are staged and will be committed alongside this iteration's state updates.
