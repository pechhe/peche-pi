import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  desktopIpc,
  piDesktopApiIpcBridge,
  piDesktopApiLocalEntries,
} from "../src/ipc.ts";
import {
  desktopIpcContracts,
  verifyChannelUniqueness,
  verifyDesktopIpcCoverage,
  getContract,
  getContractByChannel,
  validateUrl,
  validateNonEmptyString,
  validateTerminalId,
} from "./desktop-ipc-seam.ts";

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
  return sortUnique([...source.matchAll(regex)].flatMap((match) => (match[1] ? [match[1]] : [])));
}

function extractPreloadBody(source: string): string {
  const startMarker = 'contextBridge.exposeInMainWorld("piApp", {';
  const start = source.indexOf(startMarker);
  const end = source.lastIndexOf("});");
  assert.ok(start >= 0 && end > start, "preload piApp exposure exists");
  return source.slice(start + startMarker.length, end);
}

function _extractPreloadApiEntries(source: string): readonly string[] {
  return extractRegex(extractPreloadBody(source), /^  ([A-Za-z_][A-Za-z0-9_]*):/gm);
}

function extractPiDesktopApiEntries(source: string): readonly string[] {
  const body = source
    .split("export interface PiDesktopApi {", 2)[1]
    ?.split("\n}", 2)[0];
  assert.ok(body, "PiDesktopApi Interface exists");
  return extractRegex(body, /^  ([A-Za-z_][A-Za-z0-9_]*)[(:]/gm);
}

function _extractPreloadBridgeEntries(source: string): Map<string, { kind: BridgeKind; channelKey: string }> {
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

// ---------------------------------------------------------------------------
// Registry behavior tests
// ---------------------------------------------------------------------------

test("registry channel names are unique", () => {
  verifyChannelUniqueness();
});

test("every desktopIpc constant is represented in the registry", () => {
  verifyDesktopIpcCoverage();
});

test("registry contracts match bridge metadata", () => {
  for (const contract of desktopIpcContracts) {
    const bridgeEntry = (piDesktopApiIpcBridge as Record<string, { kind: BridgeKind; channel: string }>)[contract.methodName];
    assert.ok(bridgeEntry, `contract ${contract.methodName} must have a bridge entry`);
    assert.equal(bridgeEntry.kind, contract.kind, `${contract.methodName} bridge kind must match contract`);
    assert.equal(bridgeEntry.channel, contract.channel, `${contract.methodName} bridge channel must match contract`);
  }

  // Bridge must not have extra entries
  for (const methodName of Object.keys(piDesktopApiIpcBridge as Record<string, unknown>)) {
    const contract = getContract(methodName);
    assert.ok(contract, `bridge entry ${methodName} must have a contract`);
  }
});

test("registry contracts match PiDesktopApi interface entries", () => {
  const ipcSource = readRelativeSource("../src/ipc.ts");
  const apiEntries = extractPiDesktopApiEntries(ipcSource);
  const contractMethodNames = sortUnique(desktopIpcContracts.map((c) => c.methodName));
  const allMethodNames = sortUnique([...contractMethodNames, ...piDesktopApiLocalEntries]);

  assert.deepEqual(apiEntries, allMethodNames, "PiDesktopApi Interface must match registry + local entries");
});

test("registry contracts have main handlers or documented event-only role", () => {
  const mainSource = readRelativeSource("./main.ts");

  // Detect inline ipcMain.handle(desktopIpc.xxx) or ipcMain.on(desktopIpc.xxx)
  const handledKeysInline = new Set(extractRegex(mainSource, /ipcMain\.handle\(\s*desktopIpc\.([A-Za-z0-9_]+)/g));
  const onKeysInline = new Set(extractRegex(mainSource, /ipcMain\.on\(\s*desktopIpc\.([A-Za-z0-9_]+)/g));

  // Detect registerMainHandlers() call — if present, ALL non-event-only contracts are registered
  const usesRegistry = mainSource.includes("registerMainHandlers(");

  // The seam module registers handlers for all non-event-only, non-local contracts
  const registryHandledContracts = usesRegistry
    ? new Set(desktopIpcContracts.filter((c) => !c.eventOnly && !c.local).map((c) => c.methodName))
    : new Set<string>();

  const channelKeysByValue = new Map(Object.entries(desktopIpc as Record<string, string>).map(([key, value]) => [value, key]));

  for (const contract of desktopIpcContracts) {
    const channelKey = channelKeysByValue.get(contract.channel);
    assert.ok(channelKey, `${contract.methodName} channel must exist in desktopIpc`);

    if (contract.eventOnly) {
      // Event-only channels must NOT have ipcMain.handle or ipcMain.on
      assert.ok(
        !handledKeysInline.has(channelKey) && !onKeysInline.has(channelKey) && !registryHandledContracts.has(contract.methodName),
        `${contract.methodName} event-only channel must not have main handler`,
      );
    } else if (contract.kind === "invoke") {
      assert.ok(
        handledKeysInline.has(channelKey) || registryHandledContracts.has(contract.methodName),
        `${contract.methodName} invoke channel must have ipcMain.handle`,
      );
    } else if (contract.kind === "send" || contract.kind === "sendSync") {
      assert.ok(
        onKeysInline.has(channelKey) || registryHandledContracts.has(contract.methodName),
        `${contract.methodName} ${contract.kind} channel must have ipcMain.on`,
      );
    }
  }
});

test("desktopIpc channel names remain unique", () => {
  const channelValues = Object.values(desktopIpc);
  assert.equal(channelValues.length, new Set(channelValues).size, "desktopIpc channel names must remain unique");
});

test("registry has no duplicate method names", () => {
  const methodNames = desktopIpcContracts.map((c) => c.methodName);
  assert.equal(methodNames.length, new Set(methodNames).size, "registry method names must be unique");
});

test("registry has no duplicate channels", () => {
  const channels = desktopIpcContracts.map((c) => c.channel);
  assert.equal(channels.length, new Set(channels).size, "registry channels must be unique");
});

test("validation functions reject dangerous inputs", () => {

  // validateUrl
  assert.throws(() => validateUrl(123), TypeError);
  assert.throws(() => validateUrl("not-a-url"), TypeError);
  assert.throws(() => validateUrl("ftp://example.com"), TypeError);
  assert.throws(() => validateUrl("javascript:alert(1)"), TypeError);
  assert.doesNotThrow(() => validateUrl("https://example.com"));
  assert.doesNotThrow(() => validateUrl("http://localhost:3000"));

  // validateNonEmptyString
  assert.throws(() => validateNonEmptyString("", "test"), TypeError);
  assert.throws(() => validateNonEmptyString(123, "test"), TypeError);
  assert.doesNotThrow(() => validateNonEmptyString("hello", "test"));

  // validateTerminalId
  assert.throws(() => validateTerminalId(""), TypeError);
  assert.throws(() => validateTerminalId(null), TypeError);
  assert.doesNotThrow(() => validateTerminalId("term-123"));
});

test("getContract and getContractByChannel lookup helpers work", () => {
  const pingContract = getContract("ping");
  assert.ok(pingContract, "ping contract exists");
  assert.equal(pingContract.channel, "app:ping");
  assert.equal(pingContract.adapter, "system");

  const openExternalContract = getContract("openExternal");
  assert.ok(openExternalContract, "openExternal contract exists");
  assert.ok(openExternalContract.validate, "openExternal has validation");

  const byChannel = getContractByChannel("pi-gui:theme-changed");
  assert.ok(byChannel, "theme-changed contract found by channel");
  assert.equal(byChannel.methodName, "onThemeChanged");
  assert.equal(byChannel.eventOnly, true);
});
