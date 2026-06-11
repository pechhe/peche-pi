import { test } from "node:test";
import assert from "node:assert";
import { hasCollision, type ComposerUnitPlacement } from "../../src/composer-layout.ts";

const placements: ComposerUnitPlacement[] = [
  { unitId: "builtin:mode", row: 0, col: 0, colSpan: 2 },
  { unitId: "builtin:model", row: 0, col: 2, colSpan: 3 },
  { unitId: "builtin:send", row: 0, col: 11, colSpan: 1 },
  { unitId: "chassis:wrap", row: 1, col: 0, colSpan: 2 },
];

test("returns false when target cells are empty", () => {
  assert.strictEqual(hasCollision(placements, 0, 5, 2), false);
  assert.strictEqual(hasCollision(placements, 1, 4, 3), false);
  assert.strictEqual(hasCollision(placements, 2, 0, 4), false);
});

test("detects full overlap", () => {
  // Exact same position as builtin:mode
  assert.strictEqual(hasCollision(placements, 0, 0, 2), true);
});

test("detects partial overlap from left", () => {
  // Col 1-3 overlaps builtin:mode (0-2) and builtin:model (2-5)
  assert.strictEqual(hasCollision(placements, 0, 1, 2), true);
});

test("detects partial overlap from right", () => {
  // Col 4-6 overlaps builtin:model (2-5)
  assert.strictEqual(hasCollision(placements, 0, 4, 2), true);
});

test("no collision on adjacent placement", () => {
  // Col 5-7 is right after builtin:model (2-5), no overlap
  assert.strictEqual(hasCollision(placements, 0, 5, 2), false);
});

test("no collision on different row", () => {
  // Same columns as builtin:mode but row 1 (only chassis:wrap at 0-2 on row 1)
  assert.strictEqual(hasCollision(placements, 0, 0, 2, undefined), true);
  // Row 0, col 9-11 is empty (send is at 11)
  assert.strictEqual(hasCollision(placements, 0, 9, 2), false);
});

test("excludeUnitId skips the specified unit", () => {
  // builtin:mode at row 0, col 0, span 2 — excluded, so no collision
  assert.strictEqual(hasCollision(placements, 0, 0, 2, "builtin:mode"), false);
  // But builtin:model at col 2 still collides
  assert.strictEqual(hasCollision(placements, 0, 1, 2, "builtin:mode"), true);
});

test("empty placements has no collisions", () => {
  assert.strictEqual(hasCollision([], 0, 0, 4), false);
});
