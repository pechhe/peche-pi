import { test } from "node:test";
import assert from "node:assert/strict";
import { reduce } from "./app-state-reducer.ts";
import { createEmptyDesktopAppState } from "../src/desktop-state.ts";

test("settings/setSidebarCollapsed sets the field, clears lastError, bumps revision", () => {
  const base = {
    ...createEmptyDesktopAppState(),
    sidebarCollapsed: false,
    lastError: "boom",
    revision: 7,
  };
  const next = reduce(base, { type: "settings/setSidebarCollapsed", sidebarCollapsed: true });
  assert.equal(next.sidebarCollapsed, true);
  assert.equal(next.lastError, undefined);
  assert.equal(next.revision, 8);
});

test("settings/setSidebarCollapsed returns the same state reference when value is unchanged", () => {
  const base = { ...createEmptyDesktopAppState(), sidebarCollapsed: true };
  const next = reduce(base, { type: "settings/setSidebarCollapsed", sidebarCollapsed: true });
  // Identity-equal — callers rely on this to detect no-ops without
  // structural diffing.
  assert.equal(next, base);
});

test("settings/setSidebarCollapsed does not mutate the input state", () => {
  const base = { ...createEmptyDesktopAppState(), sidebarCollapsed: false, revision: 3 };
  const frozen = Object.freeze({ ...base });
  reduce(frozen, { type: "settings/setSidebarCollapsed", sidebarCollapsed: true });
  // If reduce mutated the input, Object.freeze would have thrown above.
  assert.equal(frozen.sidebarCollapsed, false);
  assert.equal(frozen.revision, 3);
});
