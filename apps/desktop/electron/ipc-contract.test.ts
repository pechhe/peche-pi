import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { desktopIpc, piDesktopApiIpcBridge, piDesktopApiLocalEntries } from "../src/ipc.ts";

type BridgeKind = "invoke" | "send" | "sendSync" | "event";

function readRelativeSource(path: string): string {
  const sourcePath = path.replace(/^\.\//, "").replace(/^\.\.\/src\//, "src/");
  const candidates = [
    resolve(process.cwd(), "apps/desktop", sourcePath),
    resolve(process.cwd(), "apps/desktop/electron", sourcePath),
    resolve(process.cwd(), sourcePath),
    resolve(process.cwd(), "electron", sourcePath),
  ];
  const existing = candidates.find((candidate) => existsSync(candidate));
  assert.ok(existing, `source file exists for ${path}`);
  return readFileSync(existing, "utf8");
}

function sortUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function extractRegex(source: string, regex: RegExp): string[] {
  return sortUnique([...source.matchAll(regex)].flatMap((match) => match[1] ? [match[1]] : []));
}

function extractPreloadBody(source: string): string {
  const startMarker = 'contextBridge.exposeInMainWorld("piApp", {';
  const start = source.indexOf(startMarker);
  const end = source.lastIndexOf("});");
  assert.ok(start >= 0 && end > start, "preload piApp exposure exists");
  return source.slice(start + startMarker.length, end);
}

function extractPreloadApiEntries(source: string): readonly string[] {
  return extractRegex(extractPreloadBody(source), /^  ([A-Za-z_][A-Za-z0-9_]*):/gm);
}

function extractPiDesktopApiEntries(source: string): readonly string[] {
  const body = source
    .split("export interface PiDesktopApi {", 2)[1]
    ?.split("\n}", 2)[0];
  assert.ok(body, "PiDesktopApi Interface exists");
  return extractRegex(body, /^  ([A-Za-z_][A-Za-z0-9_]*)[(:]/gm);
}

function extractPreloadBridgeEntries(source: string): Map<string, { kind: BridgeKind; channelKey: string }> {
  const body = extractPreloadBody(source);
  const entries = new Map<string, { kind: BridgeKind; channelKey: string }>();
  const entryStarts = [...body.matchAll(/^  ([A-Za-z_][A-Za-z0-9_]*):/gm)];
  for (let index = 0; index < entryStarts.length; index += 1) {
    const chunk = entryStarts[index];
    assert.ok(chunk, "preload entry exists");
    const apiName = chunk[1];
    assert.ok(apiName, "preload entry name exists");
    const sourceChunk = body.slice(chunk.index, entryStarts[index + 1]?.index ?? body.length);
    const channelKeys = sortUnique(extractRegex(sourceChunk, /desktopIpc\.([A-Za-z0-9_]+)/g));
    if (channelKeys.length === 0) {
      continue;
    }
    assert.equal(channelKeys.length, 1, `${apiName} must use one explicit IPC channel`);
    const kind: BridgeKind = sourceChunk.includes("ipcRenderer.invoke")
      ? "invoke"
      : sourceChunk.includes("ipcRenderer.sendSync")
        ? "sendSync"
        : sourceChunk.includes("ipcRenderer.send")
          ? "send"
          : "event";
    const channelKey = channelKeys[0];
    assert.ok(channelKey, `${apiName} IPC channel key exists`);
    entries.set(apiName, { kind, channelKey });
  }
  return entries;
}

test("Desktop App IPC bridge registry matches preload and renderer Interface", () => {
  const preloadSource = readRelativeSource("./preload.ts");
  const ipcSource = readRelativeSource("../src/ipc.ts");

  const registeredApiEntries = sortUnique([
    ...Object.keys(piDesktopApiIpcBridge),
    ...piDesktopApiLocalEntries,
  ]);

  assert.deepEqual(
    extractPreloadApiEntries(preloadSource),
    registeredApiEntries,
    "preload window.piApp entries must be registered at the IPC Seam",
  );
  assert.deepEqual(
    extractPiDesktopApiEntries(ipcSource),
    registeredApiEntries,
    "renderer PiDesktopApi Interface must match registered window.piApp entries",
  );

  const preloadBridgeEntries = extractPreloadBridgeEntries(preloadSource);
  for (const [apiName, contract] of Object.entries(piDesktopApiIpcBridge)) {
    const preloadEntry = preloadBridgeEntries.get(apiName);
    assert.ok(preloadEntry, `${apiName} must use its registered IPC channel in preload`);
    assert.deepEqual(
      preloadEntry,
      {
        kind: contract.kind,
        channelKey: Object.entries(desktopIpc).find(([, channel]) => channel === contract.channel)?.[0],
      },
      `${apiName} preload IPC Implementation must match registered Interface metadata`,
    );
  }
});

test("Desktop App IPC command channels have main handlers or documented event-only role", () => {
  const mainSource = readRelativeSource("./main.ts");
  const handledKeys = new Set(extractRegex(mainSource, /ipcMain\.handle\(\s*desktopIpc\.([A-Za-z0-9_]+)/g));
  const onKeys = new Set(extractRegex(mainSource, /ipcMain\.on\(\s*desktopIpc\.([A-Za-z0-9_]+)/g));
  const channelKeysByValue = new Map(Object.entries(desktopIpc).map(([key, value]) => [value, key]));

  for (const [apiName, contract] of Object.entries(piDesktopApiIpcBridge)) {
    const channelKey = channelKeysByValue.get(contract.channel);
    assert.ok(channelKey, `${apiName} channel must exist in desktopIpc`);
    if (contract.kind === "invoke") {
      assert.ok(handledKeys.has(channelKey), `${apiName} invoke channel must have ipcMain.handle`);
    } else if (contract.kind === "send" || contract.kind === "sendSync") {
      assert.ok(onKeys.has(channelKey), `${apiName} ${contract.kind} channel must have ipcMain.on`);
    } else {
      assert.ok(!handledKeys.has(channelKey) && !onKeys.has(channelKey), `${apiName} event channel must stay event-only`);
    }
  }

  const registeredChannelKeys = sortUnique(
    Object.values(piDesktopApiIpcBridge).map((contract) => {
      const key = channelKeysByValue.get(contract.channel);
      assert.ok(key, `registered channel ${contract.channel} must exist`);
      return key;
    }),
  );
  assert.deepEqual(
    registeredChannelKeys,
    sortUnique(Object.keys(desktopIpc)),
    "every desktopIpc channel must be classified as command or event metadata",
  );

  const channelValues = Object.values(desktopIpc);
  assert.equal(channelValues.length, new Set(channelValues).size, "desktopIpc channel names must remain unique");
});
