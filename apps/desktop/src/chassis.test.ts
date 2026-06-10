import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseChassisState, type ChassisAction } from "./chassis.ts";

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

  it("returns empty state for invalid JSON or missing actions, never throwing", () => {
    assert.deepEqual(parseChassisState("not json{"), { actions: [], dropped: 0 });
    assert.deepEqual(parseChassisState("{}"), { actions: [], dropped: 0 });
    assert.deepEqual(parseChassisState(JSON.stringify({ actions: "x" })), { actions: [], dropped: 0 });
  });
});
