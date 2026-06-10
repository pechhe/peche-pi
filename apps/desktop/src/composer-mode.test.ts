import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyWrapTemplate,
  buildPlanModePrompt,
  composeOutgoingPrompt,
  PLAN_MODE_PROMPT_SEPARATOR,
} from "./composer-mode.ts";

describe("applyWrapTemplate", () => {
  it("substitutes every {{input}} token with the raw text", () => {
    assert.equal(applyWrapTemplate("hi", "A {{input}} B {{input}}"), "A hi B hi");
  });
});

describe("composeOutgoingPrompt", () => {
  it("returns raw text unchanged in build mode with no wrap", () => {
    assert.equal(composeOutgoingPrompt("do it", { mode: "build" }), "do it");
  });

  it("applies the wrap in build mode", () => {
    assert.equal(
      composeOutgoingPrompt("do it", { mode: "build", wrapTemplate: "Be terse.\n{{input}}" }),
      "Be terse.\ndo it",
    );
  });

  it("matches buildPlanModePrompt in plan mode with no wrap", () => {
    assert.equal(
      composeOutgoingPrompt("do it", { mode: "plan" }),
      buildPlanModePrompt("do it"),
    );
  });

  it("nests the wrap INSIDE plan mode (plan is the outer frame)", () => {
    const composed = composeOutgoingPrompt("do it", {
      mode: "plan",
      wrapTemplate: "Be terse.\n{{input}}",
    });
    // Plan-mode separator must come before the wrapped user content.
    const sepIdx = composed.indexOf(PLAN_MODE_PROMPT_SEPARATOR);
    const wrapIdx = composed.indexOf("Be terse.");
    const rawIdx = composed.indexOf("do it");
    assert.ok(sepIdx >= 0, "plan separator present");
    assert.ok(sepIdx < wrapIdx, "plan frame is outside the wrap");
    assert.ok(wrapIdx < rawIdx, "wrap frames the raw text");
    // Equivalent to plan(wrap(raw)).
    assert.equal(composed, buildPlanModePrompt(applyWrapTemplate("do it", "Be terse.\n{{input}}")));
  });
});
