import assert from "node:assert/strict";
import test from "node:test";
import { collectLoopIterations, loopMarkerIteration } from "../src/session-supervisor-utils.ts";

function marker(iteration: number) {
  return { type: "custom", customType: "ralph_loop", data: { iteration } };
}

function userMsg(id: string, text: string) {
  return { type: "message", id, timestamp: "2026-06-03T00:00:00.000Z", message: { role: "user", content: text } };
}

function assistantMsg(id: string, text: string) {
  return { type: "message", id, timestamp: "2026-06-03T00:00:01.000Z", message: { role: "assistant", content: text } };
}

test("loopMarkerIteration reads iteration from a ralph_loop marker", () => {
  assert.equal(loopMarkerIteration([userMsg("u", "hi"), marker(3)]), 3);
  assert.equal(loopMarkerIteration([userMsg("u", "hi")]), undefined);
});

test("collectLoopIterations returns null for a non-loop session", () => {
  const result = collectLoopIterations({
    leafEntries: [userMsg("u1", "hello"), assistantMsg("a1", "hi")],
    leafSessionId: "s-leaf",
    leafMessages: [{ role: "user", content: "hello", id: "u1" }],
    leafUpdatedAt: "2026-06-03T00:00:00.000Z",
    leafSessionFile: "/sessions/leaf.jsonl",
    sessions: [],
    readEntries: () => [],
  });
  assert.equal(result, null);
});

test("collectLoopIterations stitches the parentSession chain root-first with live leaf last", () => {
  // Chain: root(iter1) <- mid(iter2) <- leaf(iter3, live)
  const rootEntries = [userMsg("r-u", "task"), assistantMsg("r-a", "did iter1")];
  const midEntries = [marker(2), userMsg("m-u", "continue"), assistantMsg("m-a", "did iter2")];

  const result = collectLoopIterations({
    leafEntries: [marker(3)],
    leafSessionId: "s-leaf",
    leafMessages: [{ role: "assistant", content: "doing iter3 now", id: "l-a" }],
    leafUpdatedAt: "2026-06-03T00:00:05.000Z",
    leafSessionFile: "/sessions/leaf.jsonl",
    sessions: [
      { path: "/sessions/root.jsonl", id: "s-root", parentSessionPath: undefined, modifiedIso: "2026-06-03T00:00:01.000Z" },
      { path: "/sessions/mid.jsonl", id: "s-mid", parentSessionPath: "/sessions/root.jsonl", modifiedIso: "2026-06-03T00:00:03.000Z" },
      { path: "/sessions/leaf.jsonl", id: "s-leaf", parentSessionPath: "/sessions/mid.jsonl", modifiedIso: "2026-06-03T00:00:05.000Z" },
    ],
    readEntries: (path) =>
      path === "/sessions/root.jsonl" ? rootEntries : path === "/sessions/mid.jsonl" ? midEntries : [],
  });

  assert.ok(result, "expected loop iterations");
  assert.equal(result.length, 3);

  // Root-first; iteration 1 has no marker so it is labelled positionally.
  assert.equal(result[0].label, "Iteration 1");
  assert.equal(result[0].sessionId, "s-root");
  assert.deepEqual(
    result[0].messages.map((m) => m.text),
    ["task", "did iter1"],
  );

  assert.equal(result[1].label, "Iteration 2");
  assert.equal(result[1].sessionId, "s-mid");
  assert.deepEqual(
    result[1].messages.map((m) => m.text),
    ["continue", "did iter2"],
  );

  // Live leaf last, from in-memory messages.
  assert.equal(result[2].label, "Iteration 3");
  assert.equal(result[2].sessionId, "s-leaf");
  assert.deepEqual(
    result[2].messages.map((m) => m.text),
    ["doing iter3 now"],
  );
});

test("collectLoopIterations stops at a broken parent link without looping", () => {
  const result = collectLoopIterations({
    leafEntries: [marker(2)],
    leafSessionId: "s-leaf",
    leafMessages: [],
    leafUpdatedAt: "2026-06-03T00:00:05.000Z",
    leafSessionFile: "/sessions/leaf.jsonl",
    sessions: [
      // leaf points at a parent path that is not in the catalog.
      { path: "/sessions/leaf.jsonl", id: "s-leaf", parentSessionPath: "/sessions/missing.jsonl", modifiedIso: "x" },
    ],
    readEntries: () => [],
  });
  assert.ok(result);
  assert.equal(result.length, 1, "only the live leaf when ancestry is unresolvable");
  assert.equal(result[0].sessionId, "s-leaf");
});
