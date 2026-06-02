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

test("settings/setEnableTransparency sets the field and is a no-op when unchanged", () => {
  const base = { ...createEmptyDesktopAppState(), enableTransparency: false, revision: 1 };
  const next = reduce(base, { type: "settings/setEnableTransparency", enableTransparency: true });
  assert.equal(next.enableTransparency, true);
  assert.equal(next.revision, 2);

  const noop = reduce(next, { type: "settings/setEnableTransparency", enableTransparency: true });
  assert.equal(noop, next);
});

test("settings/setComposerDeviceMode sets the field and is a no-op when unchanged", () => {
  const base = { ...createEmptyDesktopAppState(), composerDeviceMode: "off" as const };
  const next = reduce(base, { type: "settings/setComposerDeviceMode", composerDeviceMode: "screen" });
  assert.equal(next.composerDeviceMode, "screen");

  const noop = reduce(next, { type: "settings/setComposerDeviceMode", composerDeviceMode: "screen" });
  assert.equal(noop, next);
});

test("settings/setThemeMode sets the field and is a no-op when unchanged", () => {
  const base = { ...createEmptyDesktopAppState(), themeMode: "system" as const };
  const next = reduce(base, { type: "settings/setThemeMode", themeMode: "dark" });
  assert.equal(next.themeMode, "dark");

  const noop = reduce(next, { type: "settings/setThemeMode", themeMode: "dark" });
  assert.equal(noop, next);
});

test("settings/setIntegratedTerminalShell sets the field exactly as given (caller normalises)", () => {
  const base = { ...createEmptyDesktopAppState(), integratedTerminalShell: "" };
  const next = reduce(base, {
    type: "settings/setIntegratedTerminalShell",
    integratedTerminalShell: "/bin/zsh",
  });
  assert.equal(next.integratedTerminalShell, "/bin/zsh");

  // No-op identity when value unchanged.
  const noop = reduce(next, {
    type: "settings/setIntegratedTerminalShell",
    integratedTerminalShell: "/bin/zsh",
  });
  assert.equal(noop, next);
});

test("settings/setCommitPushModel sets the field and is a no-op when unchanged", () => {
  const base = { ...createEmptyDesktopAppState(), commitPushModel: undefined };
  const next = reduce(base, { type: "settings/setCommitPushModel", commitPushModel: "openai/gpt-4" });
  assert.equal(next.commitPushModel, "openai/gpt-4");

  const noop = reduce(next, { type: "settings/setCommitPushModel", commitPushModel: "openai/gpt-4" });
  assert.equal(noop, next);
});

test("view/setActiveView sets the field, clears lastError, bumps revision", () => {
  const base = {
    ...createEmptyDesktopAppState(),
    activeView: "threads" as const,
    lastError: "boom",
    revision: 4,
  };
  const next = reduce(base, { type: "view/setActiveView", activeView: "settings" });
  assert.equal(next.activeView, "settings");
  assert.equal(next.lastError, undefined);
  assert.equal(next.revision, 5);
});

test("view/setActiveView ALWAYS bumps revision, even when the view is unchanged", () => {
  // Documented deviation from the no-op convention: callers rely on a
  // fresh revision so re-selecting the current view still produces a
  // state-changed event for downstream side effects.
  const base = { ...createEmptyDesktopAppState(), activeView: "threads" as const, revision: 10 };
  const next = reduce(base, { type: "view/setActiveView", activeView: "threads" });
  assert.notEqual(next, base);
  assert.equal(next.activeView, "threads");
  assert.equal(next.revision, 11);
});

test("settings/mergeNotificationPreferences merges shallowly and always bumps revision", () => {
  const base = {
    ...createEmptyDesktopAppState(),
    notificationPreferences: { backgroundCompletion: true, backgroundFailure: true, attentionNeeded: true },
    revision: 5,
  };
  const next = reduce(base, {
    type: "settings/mergeNotificationPreferences",
    preferences: { backgroundFailure: false },
  });
  assert.deepEqual(next.notificationPreferences, {
    backgroundCompletion: true,
    backgroundFailure: false,
    attentionNeeded: true,
  });
  assert.equal(next.revision, 6);

  // Existing behaviour: even an empty-or-identical patch still bumps revision.
  // Preserved verbatim so step-2 cannot smuggle a behaviour change.
  const stillBumps = reduce(next, { type: "settings/mergeNotificationPreferences", preferences: {} });
  assert.equal(stillBumps.revision, 7);
  assert.notEqual(stillBumps, next);
});
