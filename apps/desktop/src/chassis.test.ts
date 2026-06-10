import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseChassisFile,
  parseChassisState,
  resolveFolderState,
  toggleStickyActivation,
  type ChassisAction,
} from "./chassis.ts";

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

  it("accepts sticky/reminder actions with text", () => {
    const raw = JSON.stringify({
      version: 1,
      actions: [
        { id: "r1", label: "Standing rule", showLabel: true, trigger: "sticky",
          effect: { type: "reminder", text: "Always write tests first." } },
      ],
    });
    const { actions, dropped } = parseChassisState(raw);
    assert.equal(dropped, 0);
    assert.deepEqual(actions[0], {
      id: "r1", label: "Standing rule", showLabel: true, trigger: "sticky",
      effect: { type: "reminder", text: "Always write tests first." },
    });
  });

  it("drops reminder effects whose text is missing or non-string", () => {
    const raw = JSON.stringify({
      version: 1,
      actions: [
        { id: "r-bad", label: "x", trigger: "sticky", effect: { type: "reminder" } },
        { id: "r-bad2", label: "x", trigger: "sticky", effect: { type: "reminder", text: 5 } },
      ],
    });
    const { actions, dropped } = parseChassisState(raw);
    assert.deepEqual(actions.map((a) => a.id), []);
    assert.equal(dropped, 2);
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

describe("parseChassisFile (per-folder, v2)", () => {
  const submit = (id: string) => ({
    id, label: id, trigger: "oneShot", effect: { type: "submit", text: "/" + id },
  });

  it("parses folder-keyed definitions + activation, validating each folder's actions", () => {
    const raw = JSON.stringify({
      version: 2,
      folders: {
        "/a": { actions: [submit("x")], activeStickyId: null },
        "/b": {
          actions: [
            { id: "w", label: "W", trigger: "sticky", effect: { type: "wrap", template: "{{input}}" } },
            "garbage",
          ],
          activeStickyId: "w",
        },
      },
    });
    const file = parseChassisFile(raw);
    assert.deepEqual(file["/a"]!.actions.map((a) => a.id), ["x"]);
    assert.equal(file["/a"]!.activeStickyId, null);
    assert.deepEqual(file["/b"]!.actions.map((a) => a.id), ["w"]);
    assert.equal(file["/b"]!.activeStickyId, "w");
  });

  it("nulls an activeStickyId that does not match any surviving action", () => {
    const raw = JSON.stringify({
      version: 2,
      folders: { "/a": { actions: [submit("x")], activeStickyId: "ghost" } },
    });
    assert.equal(parseChassisFile(raw)["/a"]!.activeStickyId, null);
  });

  it("returns empty record for invalid JSON / non-v2 shapes, never throwing", () => {
    assert.deepEqual(parseChassisFile("nope{"), {});
    assert.deepEqual(parseChassisFile(JSON.stringify({ version: 1, actions: [] })), {});
    assert.deepEqual(parseChassisFile("{}"), {});
  });
});

describe("resolveFolderState (fallback)", () => {
  it("falls back to an empty set + no activation for an unconfigured folder", () => {
    const file = parseChassisFile(JSON.stringify({ version: 2, folders: {} }));
    assert.deepEqual(resolveFolderState(file, "/unknown"), { actions: [], activeStickyId: null });
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
