import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseChassisState, toggleStickyActivation, type ChassisAction } from "./chassis.ts";

describe("parseChassisState", () => {
  it("returns valid one-shot/submit actions", () => {
    const raw = JSON.stringify({
      version: 1,
      actions: [
        {
          id: "a1",
          label: "Security audit",
          showLabel: true,
          trigger: "oneShot",
          effect: { type: "submit", text: "/security-scan" },
        },
      ],
    });

    const { actions, dropped } = parseChassisState(raw);

    assert.equal(dropped, 0);
    assert.equal(actions.length, 1);
    const action: ChassisAction = actions[0]!;
    assert.deepEqual(action, {
      id: "a1",
      label: "Security audit",
      showLabel: true,
      trigger: "oneShot",
      effect: { type: "submit", text: "/security-scan" },
    });
  });

  it("drops malformed entries without throwing, keeping valid ones", () => {
    const raw = JSON.stringify({
      version: 1,
      actions: [
        { id: "good", label: "Good", trigger: "oneShot", effect: { type: "submit", text: "/go" } },
        { id: "", label: "no id", trigger: "oneShot", effect: { type: "submit", text: "/x" } },
        { label: "missing id", trigger: "oneShot", effect: { type: "submit", text: "/x" } },
        { id: "bad-effect", label: "x", trigger: "oneShot", effect: { type: "submit" } },
        { id: "bad-trigger", label: "x", trigger: "nope", effect: { type: "submit", text: "/x" } },
        "not-an-object",
        null,
      ],
    });

    const { actions, dropped } = parseChassisState(raw);

    assert.deepEqual(actions.map((a) => a.id), ["good"]);
    assert.equal(dropped, 6);
  });

  it("accepts sticky/wrap actions whose template contains {{input}}", () => {
    const raw = JSON.stringify({
      version: 1,
      actions: [
        { id: "w1", label: "Reviewer", showLabel: false, trigger: "sticky",
          effect: { type: "wrap", template: "Be terse.\n{{input}}" } },
      ],
    });
    const { actions, dropped } = parseChassisState(raw);
    assert.equal(dropped, 0);
    assert.deepEqual(actions[0], {
      id: "w1", label: "Reviewer", showLabel: false, trigger: "sticky",
      effect: { type: "wrap", template: "Be terse.\n{{input}}" },
    });
  });

  it("drops mismatched trigger/effect pairings and wrap templates missing {{input}}", () => {
    const raw = JSON.stringify({
      version: 1,
      actions: [
        { id: "s-submit", label: "x", trigger: "sticky", effect: { type: "submit", text: "/x" } },
        { id: "o-wrap", label: "x", trigger: "oneShot", effect: { type: "wrap", template: "{{input}}" } },
        { id: "no-token", label: "x", trigger: "sticky", effect: { type: "wrap", template: "no token here" } },
      ],
    });
    const { actions, dropped } = parseChassisState(raw);
    assert.deepEqual(actions.map((a) => a.id), []);
    assert.equal(dropped, 3);
  });

  it("returns empty state for invalid JSON or missing actions, never throwing", () => {
    assert.deepEqual(parseChassisState("not json{"), { actions: [], dropped: 0 });
    assert.deepEqual(parseChassisState("{}"), { actions: [], dropped: 0 });
    assert.deepEqual(parseChassisState(JSON.stringify({ actions: "x" })), { actions: [], dropped: 0 });
  });
});

describe("toggleStickyActivation (single-active radio)", () => {
  it("activates an id when none active", () => {
    assert.equal(toggleStickyActivation(null, "a"), "a");
  });
  it("turning the active one off clears activation", () => {
    assert.equal(toggleStickyActivation("a", "a"), null);
  });
  it("turning on a second replaces the first (only one active)", () => {
    assert.equal(toggleStickyActivation("a", "b"), "b");
  });
});
