import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFleet } from "./subagent-fleet.ts";

// Plain-text widget lines as captured by pi-sdk-driver (host theme returns text
// unchanged, so no ANSI codes). Tree glyphs and spinner remain.
const SAMPLE: readonly string[] = [
  "● Agents · 2 running · 12.3s",
  "├─ ◜ auth-scout [scout] · 3 tool uses · 12.5%/200k ctx",
  "│    Auth implementation map",
  "│    reading…",
  "└─ ◜ diff-reviewer [reviewer] · 1 tool use · 8.1%/200k ctx",
  "     Local diff review",
  "     editing…",
];

test("parseFleet extracts count and per-agent rows", () => {
  const fleet = parseFleet(SAMPLE);
  assert.ok(fleet);
  assert.equal(fleet.count, 2);
  assert.equal(fleet.agents.length, 2);

  const [first, second] = fleet.agents;
  assert.equal(first?.name, "auth-scout");
  assert.equal(first?.agent, "scout");
  assert.deepEqual(first?.stats, ["3 tool uses", "12.5%/200k ctx"]);
  assert.equal(first?.title, "Auth implementation map");
  assert.equal(first?.activity, "reading…");

  assert.equal(second?.name, "diff-reviewer");
  assert.equal(second?.agent, "reviewer");
  assert.equal(second?.title, "Local diff review");
  assert.equal(second?.activity, "editing…");
});

test("parseFleet handles an agent with no stats", () => {
  const fleet = parseFleet([
    "● Agents · 1 running · 2.0s",
    "└─ ◜ solo-worker [worker]",
    "     Doing the thing",
    "     thinking…",
  ]);
  assert.ok(fleet);
  assert.equal(fleet.agents.length, 1);
  assert.deepEqual(fleet.agents[0]?.stats, []);
  assert.equal(fleet.agents[0]?.name, "solo-worker");
});

test("parseFleet returns null for empty or non-agent content", () => {
  assert.equal(parseFleet([]), null);
  assert.equal(parseFleet(["some unrelated widget line"]), null);
});
