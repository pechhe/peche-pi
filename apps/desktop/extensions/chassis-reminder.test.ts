import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveActiveReminder } from "./chassis-reminder.ts";

describe("resolveActiveReminder", () => {
  const makeState = (
    folders: Record<string, { actions: unknown[]; activeStickyId: string | null }>,
  ) =>
    JSON.stringify({
      version: 2,
      folders,
    });

  it("returns reminder text when active sticky is a reminder effect", () => {
    const raw = makeState({
      "/project": {
        actions: [
          { id: "r1", label: "Rule", showLabel: true, trigger: "sticky", effect: { type: "reminder", text: "Always write tests." } },
        ],
        activeStickyId: "r1",
      },
    });
    assert.equal(resolveActiveReminder(raw, "/project"), "Always write tests.");
  });

  it("returns undefined for a wrap effect (not a reminder)", () => {
    const raw = makeState({
      "/project": {
        actions: [
          { id: "w1", label: "Wrap", showLabel: true, trigger: "sticky", effect: { type: "wrap", template: "{{input}}" } },
        ],
        activeStickyId: "w1",
      },
    });
    assert.equal(resolveActiveReminder(raw, "/project"), undefined);
  });

  it("returns undefined for a submit effect (not sticky-reminder)", () => {
    const raw = makeState({
      "/project": {
        actions: [
          { id: "s1", label: "Go", showLabel: true, trigger: "oneShot", effect: { type: "submit", text: "/run" } },
        ],
        activeStickyId: "s1",
      },
    });
    assert.equal(resolveActiveReminder(raw, "/project"), undefined);
  });

  it("returns undefined when no sticky is active (activeStickyId is null)", () => {
    const raw = makeState({
      "/project": {
        actions: [
          { id: "r1", label: "Rule", showLabel: true, trigger: "sticky", effect: { type: "reminder", text: "Always write tests." } },
        ],
        activeStickyId: null,
      },
    });
    assert.equal(resolveActiveReminder(raw, "/project"), undefined);
  });

  it("returns undefined for an unconfigured folder", () => {
    const raw = makeState({
      "/other": {
        actions: [
          { id: "r1", label: "Rule", showLabel: true, trigger: "sticky", effect: { type: "reminder", text: "X" } },
        ],
        activeStickyId: "r1",
      },
    });
    assert.equal(resolveActiveReminder(raw, "/project"), undefined);
  });

  it("returns undefined for invalid JSON", () => {
    assert.equal(resolveActiveReminder("not json{", "/project"), undefined);
  });

  it("returns undefined for non-v2 schema", () => {
    assert.equal(
      resolveActiveReminder(JSON.stringify({ version: 1, actions: [] }), "/project"),
      undefined,
    );
  });

  it("returns undefined when activeStickyId references a deleted action", () => {
    const raw = makeState({
      "/project": {
        actions: [
          { id: "other", label: "X", showLabel: true, trigger: "sticky", effect: { type: "reminder", text: "Y" } },
        ],
        activeStickyId: "ghost",
      },
    });
    assert.equal(resolveActiveReminder(raw, "/project"), undefined);
  });

  it("returns undefined when reminder text is empty string", () => {
    const raw = makeState({
      "/project": {
        actions: [
          { id: "r1", label: "Rule", showLabel: true, trigger: "sticky", effect: { type: "reminder", text: "" } },
        ],
        activeStickyId: "r1",
      },
    });
    assert.equal(resolveActiveReminder(raw, "/project"), undefined);
  });

  it("scopes by folder — returns reminder for one folder, undefined for another", () => {
    const raw = makeState({
      "/alpha": {
        actions: [
          { id: "r1", label: "Rule", showLabel: true, trigger: "sticky", effect: { type: "reminder", text: "Alpha rule." } },
        ],
        activeStickyId: "r1",
      },
      "/beta": {
        actions: [
          { id: "w1", label: "Wrap", showLabel: true, trigger: "sticky", effect: { type: "wrap", template: "{{input}}" } },
        ],
        activeStickyId: "w1",
      },
    });
    assert.equal(resolveActiveReminder(raw, "/alpha"), "Alpha rule.");
    assert.equal(resolveActiveReminder(raw, "/beta"), undefined);
    assert.equal(resolveActiveReminder(raw, "/gamma"), undefined);
  });
});
