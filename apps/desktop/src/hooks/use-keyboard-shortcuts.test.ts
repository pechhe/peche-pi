import { test } from "node:test";
import assert from "node:assert/strict";
import { desktopCommands, getDesktopCommandFromShortcut } from "../ipc.ts";

// The set of commands that useKeyboardShortcuts.handleCommand dispatches.
// Update this when adding/removing commands from the Map in use-keyboard-shortcuts.ts.
const HANDLED_COMMANDS = new Set([
  desktopCommands.openSettings,
  desktopCommands.openNewThread,
  desktopCommands.toggleTerminal,
  desktopCommands.toggleSidebar,
  desktopCommands.commitAndPush,
  desktopCommands.setBuildMode,
  desktopCommands.setPlanMode,
]);

test("all desktopCommands are handled by useKeyboardShortcuts", () => {
  for (const [name, value] of Object.entries(desktopCommands)) {
    assert.ok(
      HANDLED_COMMANDS.has(value as (typeof desktopCommands)[keyof typeof desktopCommands]),
      `Command "${name}" (${value}) is not in HANDLED_COMMANDS — add it to the Map in use-keyboard-shortcuts.ts and this set`,
    );
  }
});

test("HANDLED_COMMANDS does not contain stale entries", () => {
  const allCommands = new Set(Object.values(desktopCommands));
  for (const cmd of HANDLED_COMMANDS) {
    assert.ok(
      allCommands.has(cmd),
      `HANDLED_COMMANDS contains "${cmd}" which is not in desktopCommands — remove stale entry`,
    );
  }
});

test("getDesktopCommandFromShortcut returns undefined when modifier is not pressed", () => {
  const result = getDesktopCommandFromShortcut({
    modifier: false,
    shift: false,
    key: "j",
    code: "KeyJ",
  });
  assert.equal(result, undefined);
});

test("getDesktopCommandFromShortcut returns toggleTerminal for Mod+J", () => {
  const result = getDesktopCommandFromShortcut({
    modifier: true,
    shift: false,
    key: "j",
    code: "KeyJ",
  });
  assert.equal(result, desktopCommands.toggleTerminal);
});

test("getDesktopCommandFromShortcut returns commitAndPush for Mod+Shift+K", () => {
  const result = getDesktopCommandFromShortcut({
    modifier: true,
    shift: true,
    key: "K",
    code: "KeyK",
  });
  assert.equal(result, desktopCommands.commitAndPush);
});

test("getDesktopCommandFromShortcut returns undefined for unbound Mod+key", () => {
  const result = getDesktopCommandFromShortcut({
    modifier: true,
    shift: false,
    key: "z",
    code: "KeyZ",
  });
  assert.equal(result, undefined);
});
