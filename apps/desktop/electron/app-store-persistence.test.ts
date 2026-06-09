import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPersistedUiState } from "./app-store-persistence.ts";

async function withTempFile(
  contents: string | null,
  run: (filePath: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-persist-test-"));
  const filePath = join(dir, "ui-state.json");
  try {
    if (contents !== null) {
      await writeFile(filePath, contents, "utf8");
    }
    await run(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readWith(payload: Record<string, unknown>) {
  let result: Awaited<ReturnType<typeof readPersistedUiState>> | undefined;
  await withTempFile(JSON.stringify(payload), async (filePath) => {
    result = await readPersistedUiState(filePath);
  });
  return result!;
}

test("readPersistedUiState returns {} when the file is missing", async () => {
  await withTempFile(null, async (filePath) => {
    const result = await readPersistedUiState(filePath);
    assert.deepEqual(result, {});
  });
});

test("readPersistedUiState returns {} on invalid JSON", async () => {
  await withTempFile("{ not json", async (filePath) => {
    const result = await readPersistedUiState(filePath);
    assert.deepEqual(result, {});
  });
});

test("readPersistedUiState keeps known versions and drops unknown ones", async () => {
  for (const v of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const result = await readWith({ version: v });
    assert.equal(result.version, v, `version ${v} should pass through`);
  }
  for (const bad of [1, 11, 0, -1, "10", null]) {
    const result = await readWith({ version: bad });
    assert.equal(result.version, undefined, `version ${JSON.stringify(bad)} should be dropped`);
  }
});

test("readPersistedUiState normalizes composerDeviceMode enum values", async () => {
  for (const mode of ["modular-cream", "modular-metal"]) {
    const result = await readWith({ composerDeviceMode: mode });
    assert.equal(result.composerDeviceMode, mode);
  }
});

test("readPersistedUiState drops removed composerDeviceMode values", async () => {
  assert.equal((await readWith({ composerDeviceMode: "off" })).composerDeviceMode, undefined);
  assert.equal((await readWith({ composerDeviceMode: "screen" })).composerDeviceMode, undefined);
  assert.equal((await readWith({ composerDeviceMode: true })).composerDeviceMode, undefined);
  assert.equal((await readWith({ composerDeviceMode: false })).composerDeviceMode, undefined);
  assert.equal((await readWith({ composerDeviceMode: "bogus" })).composerDeviceMode, undefined);
  assert.equal((await readWith({})).composerDeviceMode, undefined);
});

test("readPersistedUiState validates themeMode against the enum", async () => {
  for (const theme of ["dracula", "dark", "light", "system"]) {
    assert.equal((await readWith({ themeMode: theme })).themeMode, theme);
  }
  assert.equal((await readWith({ themeMode: "neon" })).themeMode, undefined);
  assert.equal((await readWith({ themeMode: 1 })).themeMode, undefined);
});

test("readPersistedUiState validates modelSettingsScopeMode", async () => {
  assert.equal((await readWith({ modelSettingsScopeMode: "per-repo" })).modelSettingsScopeMode, "per-repo");
  assert.equal((await readWith({ modelSettingsScopeMode: "app-global" })).modelSettingsScopeMode, "app-global");
  assert.equal((await readWith({ modelSettingsScopeMode: "global" })).modelSettingsScopeMode, undefined);
});

test("readPersistedUiState defaults composerDraft to empty string", async () => {
  assert.equal((await readWith({})).composerDraft, "");
  assert.equal((await readWith({ composerDraft: "hi" })).composerDraft, "hi");
});

test("readPersistedUiState type-guards string fields", async () => {
  const good = await readWith({
    integratedTerminalShell: "/bin/zsh",
    externalTerminalApp: "iTerm",
    commitPushModel: "claude",
    selectedChatId: "chat-1",
  });
  assert.equal(good.integratedTerminalShell, "/bin/zsh");
  assert.equal(good.externalTerminalApp, "iTerm");
  assert.equal(good.commitPushModel, "claude");
  assert.equal(good.selectedChatId, "chat-1");

  const bad = await readWith({
    integratedTerminalShell: 42,
    externalTerminalApp: {},
    commitPushModel: [],
    selectedChatId: 7,
  });
  assert.equal(bad.integratedTerminalShell, undefined);
  assert.equal(bad.externalTerminalApp, undefined);
  assert.equal(bad.commitPushModel, undefined);
  assert.equal(bad.selectedChatId, undefined);
});

test("readPersistedUiState type-guards boolean fields", async () => {
  const good = await readWith({
    sidebarCollapsed: true,
    allowMultiple: false,
    transcriptVerbose: false,
  });
  assert.equal(good.sidebarCollapsed, true);
  assert.equal(good.allowMultiple, false);
  assert.equal(good.transcriptVerbose, false);

  const bad = await readWith({ sidebarCollapsed: "yes", allowMultiple: 1 });
  assert.equal(bad.sidebarCollapsed, undefined);
  assert.equal(bad.allowMultiple, undefined);
});

test("readPersistedUiState guards array fields", async () => {
  assert.deepEqual((await readWith({ workspaceOrder: ["a", "b"] })).workspaceOrder, ["a", "b"]);
  assert.equal((await readWith({ workspaceOrder: "a" })).workspaceOrder, undefined);
  assert.equal((await readWith({ chats: {} })).chats, undefined);
  assert.deepEqual((await readWith({ chats: [] })).chats, []);
});

test("readPersistedUiState normalizes threadTransition with curve fallback", async () => {
  assert.deepEqual(
    (await readWith({ threadTransition: { motion: "spring", heroExit: true, bubbleHandoff: true } })).threadTransition,
    { motion: "spring", heroExit: true, bubbleHandoff: true },
  );
  // Unknown motion falls back to "curve"; missing booleans default to false.
  assert.deepEqual(
    (await readWith({ threadTransition: { motion: "warp" } })).threadTransition,
    { motion: "curve", heroExit: false, bubbleHandoff: false },
  );
  assert.equal((await readWith({ threadTransition: "x" })).threadTransition, undefined);
});
