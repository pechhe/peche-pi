import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readRalphLoopStatus } from "./ralph-loop-status.ts";

function withWorkspace(loopMd: string | null, run: (path: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "ralph-loop-status-"));
  try {
    if (loopMd !== null) {
      mkdirSync(join(root, ".ralph"), { recursive: true });
      writeFileSync(join(root, ".ralph", "loop.md"), loopMd, "utf-8");
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const RUNNING_LOOP = `---
running: true
iteration: 3
max_iterations: 8
started_at: "2026-06-03T10:00:00Z"
session_id: "session-abc"
stop_reason: null
---

# Loop
`;

test("returns null when no .ralph/loop.md exists", () => {
  withWorkspace(null, (path) => {
    assert.equal(readRalphLoopStatus(path, "session-abc"), null);
  });
});

test("parses a running loop and flags the active session", () => {
  withWorkspace(RUNNING_LOOP, (path) => {
    const status = readRalphLoopStatus(path, "session-abc");
    assert.deepEqual(status, {
      running: true,
      iteration: 3,
      maxIterations: 8,
      sessionId: "session-abc",
      isSelectedSessionActive: true,
    });
  });
});

test("does not flag a non-active session as the loop iteration", () => {
  withWorkspace(RUNNING_LOOP, (path) => {
    const status = readRalphLoopStatus(path, "some-other-session");
    assert.equal(status?.isSelectedSessionActive, false);
    assert.equal(status?.running, true);
  });
});

test("parses a stopped loop with a stop reason", () => {
  const stopped = `---
running: false
iteration: 5
max_iterations: 5
session_id: "session-xyz"
stop_reason: "completed"
---
`;
  withWorkspace(stopped, (path) => {
    const status = readRalphLoopStatus(path, "session-xyz");
    assert.equal(status?.running, false);
    assert.equal(status?.stopReason, "completed");
    assert.equal(status?.isSelectedSessionActive, true);
  });
});

test("returns null when the file has no frontmatter", () => {
  withWorkspace("# just a heading\n", (path) => {
    assert.equal(readRalphLoopStatus(path, "session-abc"), null);
  });
});
