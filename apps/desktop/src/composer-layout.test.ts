import { test } from "node:test";
import assert from "node:assert";
import { validateComposerLayout, getEffectiveControlStyle, getDefaultLayout, mergeChassisActionsIntoLayout, type ComposerLayoutData, type ComposerUnitPlacement } from "./composer-layout.ts";
import type { ChassisAction } from "./chassis.ts";

test("validateComposerLayout - returns default layout for invalid input", () => {
  const availableUnitIds = new Set(["builtin:mode", "builtin:model", "builtin:reasoning", "builtin:orchestrate", "builtin:badges", "builtin:send"]);
  
  assert.deepStrictEqual(
    validateComposerLayout(null, availableUnitIds),
    getDefaultLayout()
  );
  
  assert.deepStrictEqual(
    validateComposerLayout(undefined, availableUnitIds),
    getDefaultLayout()
  );
  
  assert.deepStrictEqual(
    validateComposerLayout("not an object", availableUnitIds),
    getDefaultLayout()
  );
  
  assert.deepStrictEqual(
    validateComposerLayout({ version: 2, cols: 12, placements: [] }, availableUnitIds),
    getDefaultLayout()
  );
});

test("validateComposerLayout - drops dangling unit references", () => {
  const availableUnitIds = new Set(["builtin:mode", "builtin:model", "builtin:reasoning", "builtin:send"]);
  
  const input: ComposerLayoutData = {
    version: 1,
    cols: 12,
    placements: [
      { unitId: "builtin:mode", row: 0, col: 0, colSpan: 2 },
      { unitId: "builtin:nonexistent", row: 0, col: 2, colSpan: 2 }, // Should be dropped
      { unitId: "chassis:deleted", row: 0, col: 4, colSpan: 2 }, // Should be dropped
      { unitId: "builtin:model", row: 0, col: 6, colSpan: 3 },
    ],
  };
  
  const result = validateComposerLayout(input, availableUnitIds);
  
  // Should only have valid units + auto-inserted required ones
  const unitIds = result.placements.map(p => p.unitId);
  assert(unitIds.includes("builtin:mode"));
  assert(unitIds.includes("builtin:model"));
  assert(!unitIds.includes("builtin:nonexistent"));
  assert(!unitIds.includes("chassis:deleted"));
  
  // Should auto-insert missing required units
  assert(unitIds.includes("builtin:send"));
  assert(unitIds.includes("builtin:reasoning"));
});

test("validateComposerLayout - auto-inserts missing required units", () => {
  const availableUnitIds = new Set(["builtin:mode", "builtin:model", "builtin:reasoning", "builtin:send"]);
  
  const input: ComposerLayoutData = {
    version: 1,
    cols: 12,
    placements: [
      { unitId: "builtin:mode", row: 0, col: 0, colSpan: 2 },
      // Missing: model, reasoning, send
    ],
  };
  
  const result = validateComposerLayout(input, availableUnitIds);
  
  const unitIds = result.placements.map(p => p.unitId);
  assert(unitIds.includes("builtin:send"));
  assert(unitIds.includes("builtin:reasoning"));
  assert(unitIds.includes("builtin:model"));
});

test("validateComposerLayout - fixes invalid positions", () => {
  const availableUnitIds = new Set(["builtin:mode", "builtin:model", "builtin:reasoning", "builtin:send"]);
  
  const input: ComposerLayoutData = {
    version: 1,
    cols: 12,
    placements: [
      { unitId: "builtin:mode", row: -1, col: -5, colSpan: 20 }, // Invalid position
      { unitId: "builtin:model", row: 0.7, col: 15, colSpan: 0 }, // Invalid position
      { unitId: "builtin:reasoning", row: 0, col: 10, colSpan: 4 }, // Span exceeds grid
      { unitId: "builtin:send", row: 2, col: 11, colSpan: 1 }, // Valid
    ],
  };
  
  const result = validateComposerLayout(input, availableUnitIds);
  
  // Check first placement was fixed
  const mode = result.placements.find(p => p.unitId === "builtin:mode");
  assert(mode);
  assert.strictEqual(mode.row, 0); // Fixed from -1
  assert.strictEqual(mode.col, 0); // Fixed from -5
  assert.strictEqual(mode.colSpan, 12); // Fixed from 20 (max is 12)
  
  // Check second placement was fixed
  const model = result.placements.find(p => p.unitId === "builtin:model");
  assert(model);
  assert.strictEqual(model.row, 0); // Fixed from 0.7
  assert.strictEqual(model.col, 11); // Fixed from 15 (max is 11)
  assert.strictEqual(model.colSpan, 1); // Fixed from 0 (min is 1)
  
  // Check third placement span was clipped
  const reasoning = result.placements.find(p => p.unitId === "builtin:reasoning");
  assert(reasoning);
  assert.strictEqual(reasoning.col, 10);
  assert.strictEqual(reasoning.colSpan, 2); // Fixed from 4 (would exceed grid)
  
  // Check valid placement unchanged
  const send = result.placements.find(p => p.unitId === "builtin:send");
  assert(send);
  assert.strictEqual(send.row, 2);
  assert.strictEqual(send.col, 11);
  assert.strictEqual(send.colSpan, 1);
});

test("getEffectiveControlStyle - merges placement overrides with device defaults", () => {
  const deviceDefaults = {
    showLabel: true,
    color: "#333",
  };
  
  // No overrides - use defaults
  const placement1: ComposerUnitPlacement = {
    unitId: "builtin:mode",
    row: 0,
    col: 0,
    colSpan: 2,
  };
  assert.deepStrictEqual(
    getEffectiveControlStyle(placement1, deviceDefaults),
    { showLabel: true, color: "#333" }
  );
  
  // Override showLabel only
  const placement2: ComposerUnitPlacement = {
    unitId: "builtin:mode",
    row: 0,
    col: 0,
    colSpan: 2,
    showLabel: false,
  };
  assert.deepStrictEqual(
    getEffectiveControlStyle(placement2, deviceDefaults),
    { showLabel: false, color: "#333" }
  );
  
  // Override color only
  const placement3: ComposerUnitPlacement = {
    unitId: "builtin:mode",
    row: 0,
    col: 0,
    colSpan: 2,
    color: "#ff0000",
  };
  assert.deepStrictEqual(
    getEffectiveControlStyle(placement3, deviceDefaults),
    { showLabel: true, color: "#ff0000" }
  );
  
  // Override both
  const placement4: ComposerUnitPlacement = {
    unitId: "builtin:mode",
    row: 0,
    col: 0,
    colSpan: 2,
    showLabel: false,
    color: "#00ff00",
  };
  assert.deepStrictEqual(
    getEffectiveControlStyle(placement4, deviceDefaults),
    { showLabel: false, color: "#00ff00" }
  );
  
  // No device defaults
  const placement5: ComposerUnitPlacement = {
    unitId: "builtin:mode",
    row: 0,
    col: 0,
    colSpan: 2,
    showLabel: false,
  };
  assert.deepStrictEqual(
    getEffectiveControlStyle(placement5, {}),
    { showLabel: false, color: undefined }
  );
});

test("mergeChassisActionsIntoLayout - adds new chassis actions after built-ins", () => {
  const layout: ComposerLayoutData = {
    version: 1,
    cols: 12,
    placements: [
      { unitId: "builtin:mode", row: 0, col: 0, colSpan: 2 },
      { unitId: "builtin:model", row: 0, col: 2, colSpan: 3 },
      { unitId: "builtin:send", row: 0, col: 11, colSpan: 1 },
    ],
  };
  
  const chassisActions: ChassisAction[] = [
    { id: "act1", label: "Action 1", showLabel: true, trigger: "oneShot", effect: { type: "submit", text: "test" } },
    { id: "act2", label: "Action 2", showLabel: false, trigger: "sticky", effect: { type: "wrap", template: "{{input}}" } },
  ];
  
  const result = mergeChassisActionsIntoLayout(layout, chassisActions);
  
  // Original placements preserved
  assert.strictEqual(result.placements[0]!.unitId, "builtin:mode");
  assert.strictEqual(result.placements[1]!.unitId, "builtin:model");
  assert.strictEqual(result.placements[2]!.unitId, "builtin:send");
  
  // New chassis actions added
  assert.strictEqual(result.placements[3]!.unitId, "chassis:act1");
  assert.strictEqual(result.placements[3]!.row, 0);
  assert.strictEqual(result.placements[3]!.col, 5); // After model
  assert.strictEqual(result.placements[3]!.colSpan, 2);
  
  assert.strictEqual(result.placements[4]!.unitId, "chassis:act2");
  assert.strictEqual(result.placements[4]!.row, 0);
  assert.strictEqual(result.placements[4]!.col, 7);
  assert.strictEqual(result.placements[4]!.colSpan, 2);
});

test("mergeChassisActionsIntoLayout - wraps to next row when needed", () => {
  const layout: ComposerLayoutData = {
    version: 1,
    cols: 12,
    placements: [
      { unitId: "builtin:mode", row: 0, col: 0, colSpan: 2 },
      { unitId: "builtin:model", row: 0, col: 2, colSpan: 3 },
      { unitId: "builtin:reasoning", row: 0, col: 5, colSpan: 2 },
      { unitId: "builtin:orchestrate", row: 0, col: 7, colSpan: 2 },
      { unitId: "builtin:badges", row: 0, col: 9, colSpan: 2 },
      { unitId: "builtin:send", row: 0, col: 11, colSpan: 1 },
    ],
  };
  
  const chassisActions: ChassisAction[] = [
    { id: "act1", label: "Action 1", showLabel: true, trigger: "oneShot", effect: { type: "submit", text: "test" } },
    { id: "act2", label: "Action 2", showLabel: false, trigger: "sticky", effect: { type: "wrap", template: "{{input}}" } },
  ];
  
  const result = mergeChassisActionsIntoLayout(layout, chassisActions);
  
  // New chassis actions should wrap to row 1
  const act1 = result.placements.find(p => p.unitId === "chassis:act1");
  assert.strictEqual(act1?.row, 1);
  assert.strictEqual(act1?.col, 0);
  
  const act2 = result.placements.find(p => p.unitId === "chassis:act2");
  assert.strictEqual(act2?.row, 1);
  assert.strictEqual(act2?.col, 2);
});

test("mergeChassisActionsIntoLayout - skips already placed actions", () => {
  const layout: ComposerLayoutData = {
    version: 1,
    cols: 12,
    placements: [
      { unitId: "builtin:mode", row: 0, col: 0, colSpan: 2 },
      { unitId: "chassis:act1", row: 0, col: 2, colSpan: 3 }, // Already placed
      { unitId: "builtin:send", row: 0, col: 11, colSpan: 1 },
    ],
  };
  
  const chassisActions: ChassisAction[] = [
    { id: "act1", label: "Action 1", showLabel: true, trigger: "oneShot", effect: { type: "submit", text: "test" } },
    { id: "act2", label: "Action 2", showLabel: false, trigger: "sticky", effect: { type: "wrap", template: "{{input}}" } },
  ];
  
  const result = mergeChassisActionsIntoLayout(layout, chassisActions);
  
  // Should not duplicate act1
  const act1Count = result.placements.filter(p => p.unitId === "chassis:act1").length;
  assert.strictEqual(act1Count, 1);
  
  // Should add act2
  assert(result.placements.some(p => p.unitId === "chassis:act2"));
});