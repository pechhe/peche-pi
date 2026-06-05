import { strict as assert } from "node:assert";
import { test } from "node:test";

import { clampThinkingLevel } from "../src/session-supervisor.ts";

const ALL = ["off", "minimal", "low", "medium", "high", "xhigh"];

test("keeps a supported level unchanged", () => {
  for (const level of ALL) {
    assert.equal(clampThinkingLevel(level, ALL), level);
  }
});

test("minimal is selectable when supported (regression: was snapping back)", () => {
  assert.equal(clampThinkingLevel("minimal", ["off", "minimal", "xhigh"]), "minimal");
});

test("clamps up to the next supported level when requested is unavailable", () => {
  // low unavailable -> next supported in order is medium
  assert.equal(clampThinkingLevel("low", ["off", "medium", "high"]), "medium");
});

test("clamps down when no higher level is available", () => {
  assert.equal(clampThinkingLevel("xhigh", ["off", "minimal", "low"]), "low");
});

test("unknown level falls back to first available", () => {
  assert.equal(clampThinkingLevel("bogus", ["minimal", "low"]), "minimal");
  assert.equal(clampThinkingLevel("bogus", []), "off");
});
