import { test } from "node:test";
import assert from "node:assert";
import { getDefaultLayout, type ComposerLayoutData } from "../../src/composer-layout.ts";

test("default layout reproduces current control row order", () => {
  const defaultLayout = getDefaultLayout();
  
  // Verify it has the expected structure
  assert.strictEqual(defaultLayout.version, 1);
  assert.strictEqual(defaultLayout.cols, 12);
  assert(Array.isArray(defaultLayout.placements));
  
  // Expected order from ComposerControlRow:
  // mode · model · reasoning · orchestrate · badges · send
  const expectedOrder = [
    { unitId: "builtin:mode", col: 0, colSpan: 2 },
    { unitId: "builtin:model", col: 2, colSpan: 3 },
    { unitId: "builtin:reasoning", col: 5, colSpan: 2 },
    { unitId: "builtin:orchestrate", col: 7, colSpan: 2 },
    { unitId: "builtin:badges", col: 9, colSpan: 2 },
    { unitId: "builtin:send", col: 11, colSpan: 1 },
  ];
  
  assert.strictEqual(defaultLayout.placements.length, expectedOrder.length);
  
  for (let i = 0; i < expectedOrder.length; i++) {
    const expected = expectedOrder[i];
    const actual = defaultLayout.placements[i];
    
    assert.strictEqual(actual.unitId, expected.unitId, `Unit ${i} should be ${expected.unitId}`);
    assert.strictEqual(actual.row, 0, `Unit ${expected.unitId} should be on row 0`);
    assert.strictEqual(actual.col, expected.col, `Unit ${expected.unitId} should start at col ${expected.col}`);
    assert.strictEqual(actual.colSpan, expected.colSpan, `Unit ${expected.unitId} should span ${expected.colSpan} columns`);
  }
});