import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OverlayWindowManager,
  computeOverlayBounds,
  createOverlayWindowOptions,
  OVERLAY_SIZE,
  OVERLAY_MARGIN_BOTTOM,
  type OverlayBrowserWindow,
  type OverlayWindowOptions,
} from "./overlay-window-manager.ts";
import { desktopIpc } from "../src/ipc.ts";
import type { DesktopAppState } from "../src/desktop-state.ts";

const PRELOAD = "/abs/path/preload.js";
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };

function fakeState(tag: string): DesktopAppState {
  return { __tag: tag } as unknown as DesktopAppState;
}

interface FakeWindow extends OverlayBrowserWindow {
  destroyed: boolean;
  shown: number;
  focused: number;
  closedCalls: number;
  loadedUrl: string | null;
  sent: Array<{ channel: string; args: unknown[] }>;
  fireReadyToShow: () => void;
  fireClosed: () => void;
}

function makeFakeWindow(): FakeWindow {
  const listeners: Record<string, Array<() => void>> = {};
  const win: FakeWindow = {
    destroyed: false,
    shown: 0,
    focused: 0,
    closedCalls: 0,
    loadedUrl: null,
    sent: [],
    webContents: {
      send: (channel: string, ...args: unknown[]) => win.sent.push({ channel, args }),
      isDestroyed: () => win.destroyed,
    },
    isDestroyed: () => win.destroyed,
    show: () => { win.shown += 1; },
    focus: () => { win.focused += 1; },
    close: () => { win.closedCalls += 1; },
    loadURL: (url: string) => { win.loadedUrl = url; },
    once: (event, listener) => { (listeners[event] ??= []).push(listener); },
    fireReadyToShow: () => { (listeners["ready-to-show"] ?? []).forEach((l) => l()); },
    fireClosed: () => { win.destroyed = true; (listeners["closed"] ?? []).forEach((l) => l()); },
  };
  return win;
}

interface Harness {
  manager: OverlayWindowManager;
  created: FakeWindow[];
  optionsLog: OverlayWindowOptions[];
  stateListeners: Array<(state: DesktopAppState) => void>;
  unsubscribeCalls: number;
}

function makeHarness(initialState: DesktopAppState = fakeState("initial")): Harness {
  const created: FakeWindow[] = [];
  const optionsLog: OverlayWindowOptions[] = [];
  const stateListeners: Array<(state: DesktopAppState) => void> = [];
  let unsubscribeCalls = 0;
  const manager = new OverlayWindowManager({
    createWindow: (options) => {
      optionsLog.push(options);
      const win = makeFakeWindow();
      created.push(win);
      return win;
    },
    getWorkArea: () => WORK_AREA,
    preloadPath: PRELOAD,
    resolveOverlayUrl: () => "http://localhost:5173/#overlay",
    subscribeToState: (listener) => {
      stateListeners.push(listener);
      return () => { unsubscribeCalls += 1; };
    },
    getState: () => initialState,
  });
  return {
    manager,
    created,
    optionsLog,
    stateListeners,
    get unsubscribeCalls() { return unsubscribeCalls; },
  } as Harness;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

test("computeOverlayBounds centres horizontally and anchors to the bottom", () => {
  const bounds = computeOverlayBounds(WORK_AREA);
  assert.equal(bounds.width, OVERLAY_SIZE.width);
  assert.equal(bounds.height, OVERLAY_SIZE.height);
  assert.equal(bounds.x, (1920 - OVERLAY_SIZE.width) / 2);
  assert.equal(bounds.y, 1080 - OVERLAY_SIZE.height - OVERLAY_MARGIN_BOTTOM);
});

test("computeOverlayBounds respects work-area offset (non-zero x/y)", () => {
  const bounds = computeOverlayBounds({ x: 100, y: 50, width: 1000, height: 800 }, { width: 400, height: 100 }, 10);
  assert.equal(bounds.x, 100 + (1000 - 400) / 2);
  assert.equal(bounds.y, 50 + 800 - 100 - 10);
});

// ---------------------------------------------------------------------------
// Window config
// ---------------------------------------------------------------------------

test("createOverlayWindowOptions sets alwaysOnTop, transparent, frameless and shared preload", () => {
  const options = createOverlayWindowOptions(PRELOAD, computeOverlayBounds(WORK_AREA));
  assert.equal(options.alwaysOnTop, true);
  assert.equal(options.transparent, true);
  assert.equal(options.frame, false);
  assert.equal(options.resizable, false);
  assert.equal(options.show, false);
  assert.equal(options.webPreferences.preload, PRELOAD);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
});

// ---------------------------------------------------------------------------
// Lifecycle + single-instance
// ---------------------------------------------------------------------------

test("open creates a window with bottom-centre bounds and loads the overlay route", () => {
  const h = makeHarness();
  h.manager.open();
  assert.equal(h.created.length, 1);
  const opts = h.optionsLog[0]!;
  assert.equal(opts.x, (1920 - OVERLAY_SIZE.width) / 2);
  assert.equal(opts.y, 1080 - OVERLAY_SIZE.height - OVERLAY_MARGIN_BOTTOM);
  assert.equal(h.created[0]!.loadedUrl, "http://localhost:5173/#overlay");
  assert.equal(h.manager.isOpen(), true);
});

test("open shows the window on ready-to-show", () => {
  const h = makeHarness();
  h.manager.open();
  assert.equal(h.created[0]!.shown, 0);
  h.created[0]!.fireReadyToShow();
  assert.equal(h.created[0]!.shown, 1);
});

test("second open focuses the existing window instead of creating another", () => {
  const h = makeHarness();
  h.manager.open();
  h.manager.open();
  assert.equal(h.created.length, 1, "only one window created");
  assert.equal(h.created[0]!.shown, 1);
  assert.equal(h.created[0]!.focused, 1);
});

test("close closes the overlay window", () => {
  const h = makeHarness();
  h.manager.open();
  h.manager.close();
  assert.equal(h.created[0]!.closedCalls, 1);
});

test("close is a no-op when no overlay is open", () => {
  const h = makeHarness();
  assert.doesNotThrow(() => h.manager.close());
});

test("after the window emits closed, a new open creates a fresh window", () => {
  const h = makeHarness();
  h.manager.open();
  h.created[0]!.fireClosed();
  assert.equal(h.manager.isOpen(), false);
  h.manager.open();
  assert.equal(h.created.length, 2);
});

// ---------------------------------------------------------------------------
// State subscription
// ---------------------------------------------------------------------------

test("open seeds the overlay with the current state and forwards subsequent snapshots", async () => {
  const h = makeHarness(fakeState("seed"));
  h.manager.open();
  // initial state is delivered via a resolved promise
  await Promise.resolve();
  await Promise.resolve();
  const win = h.created[0]!;
  assert.equal(win.sent.length, 1);
  assert.equal(win.sent[0]!.channel, desktopIpc.stateChanged);
  assert.deepEqual(win.sent[0]!.args[0], fakeState("seed"));

  // push a live update through the subscription
  h.stateListeners[0]!(fakeState("update"));
  assert.equal(win.sent.length, 2);
  assert.deepEqual(win.sent[1]!.args[0], fakeState("update"));
});

test("closing the overlay unsubscribes from state updates", () => {
  const h = makeHarness();
  h.manager.open();
  assert.equal(h.unsubscribeCalls, 0);
  h.created[0]!.fireClosed();
  assert.equal(h.unsubscribeCalls, 1);
  // further state pushes are dropped (window destroyed)
  const before = h.created[0]!.sent.length;
  h.stateListeners[0]!(fakeState("after-close"));
  assert.equal(h.created[0]!.sent.length, before);
});
