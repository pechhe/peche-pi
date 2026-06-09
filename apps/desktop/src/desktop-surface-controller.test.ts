import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Minimal vitest-compatible shim so these tests run under `node --test`
// (the repo's unit test runner) without pulling in vitest.
function expect(actual: unknown) {
  return {
    toBe: (expected: unknown) => assert.strictEqual(actual, expected),
    toEqual: (expected: unknown) => assert.deepStrictEqual(actual, expected),
    toBeDefined: () => assert.notStrictEqual(actual, undefined),
    toBeUndefined: () => assert.strictEqual(actual, undefined),
    toBeNull: () => assert.strictEqual(actual, null),
    toContain: (expected: unknown) => {
      if (typeof actual === "string") {
        assert.ok(actual.includes(String(expected)));
      } else if (Array.isArray(actual)) {
        assert.ok(actual.includes(expected));
      } else {
        assert.fail("toContain expects a string or array");
      }
    },
    toBeGreaterThanOrEqual: (expected: number) =>
      assert.ok(typeof actual === "number" && actual >= expected),
    toHaveBeenCalledOnce: () =>
      assert.strictEqual((actual as { mock?: { calls: unknown[] } }).mock?.calls.length, 1),
  };
}
const vi = {
  fn: <A extends unknown[], R>(impl?: (...args: A) => R) => {
    const calls: A[] = [];
    const mockFn = (...args: A): R => {
      calls.push(args);
      return impl ? impl(...args) : (undefined as unknown as R);
    };
    mockFn.mock = { calls };
    return mockFn;
  },
};
import {
  canToggleSidebar,
  interpretSurfaceIntent,
  type DesktopSurface,
  type SurfaceInput,
} from "./desktop-surface-controller.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSurface(overrides: Partial<DesktopSurface> = {}): DesktopSurface {
  return {
    activeView: "threads",
    selectedWorkspaceId: "ws-1",
    selectedSessionId: "sess-1",
    rootWorkspaceId: "root-1",
    sidebarCollapsed: false,
    terminalSessionKey: "",
    threadSearchOpen: false,
    diffPanelOpen: false,
    navigationHistory: {
      goBack: vi.fn(() => null),
      goForward: vi.fn(() => null),
    },
    ...overrides,
  };
}

function makeInput(overrides: Partial<SurfaceInput> = {}): SurfaceInput {
  return {
    key: "",
    meta: false,
    shift: false,
    isInsideTerminal: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// canToggleSidebar
// ---------------------------------------------------------------------------

describe("canToggleSidebar", () => {
  it("returns true for threads view", () => {
    expect(canToggleSidebar("threads")).toBe(true);
  });

  it("returns true for new-thread view", () => {
    expect(canToggleSidebar("new-thread")).toBe(true);
  });

  it("returns true for kanban view", () => {
    expect(canToggleSidebar("kanban")).toBe(true);
  });

  it("returns true for settings view", () => {
    expect(canToggleSidebar("settings")).toBe(true);
  });

  it("returns true for skills view", () => {
    expect(canToggleSidebar("skills")).toBe(true);
  });

  it("returns true for extensions view", () => {
    expect(canToggleSidebar("extensions")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Terminal-scoped shortcuts
// ---------------------------------------------------------------------------

describe("terminal-scoped shortcuts", () => {
  it("returns toggle-terminal when Cmd+J inside terminal", () => {
    const surface = makeSurface({ terminalSessionKey: "" });
    const input = makeInput({ command: "toggle-terminal", isInsideTerminal: true, meta: true, key: "j" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "toggle-terminal", sessionId: "sess-1", open: true });
  });

  it("closes terminal when Cmd+J inside terminal and terminal is open", () => {
    const surface = makeSurface({ terminalSessionKey: "sess-1" });
    const input = makeInput({ command: "toggle-terminal", isInsideTerminal: true, meta: true, key: "j" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "toggle-terminal", sessionId: "sess-1", open: false });
  });

  it("ignores non-toggle-terminal shortcuts inside terminal", () => {
    const surface = makeSurface();
    const input = makeInput({ command: "open-settings", isInsideTerminal: true, meta: true, key: "," });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toBeNull();
  });

  it("ignores Cmd+F inside terminal", () => {
    const surface = makeSurface();
    const input = makeInput({ isInsideTerminal: true, meta: true, key: "f" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Thread search (Cmd+F)
// ---------------------------------------------------------------------------

describe("thread search toggle", () => {
  it("opens thread search when closed", () => {
    const surface = makeSurface({ threadSearchOpen: false });
    const input = makeInput({ meta: true, key: "f" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "toggle-thread-search", open: true });
  });

  it("closes thread search when open", () => {
    const surface = makeSurface({ threadSearchOpen: true });
    const input = makeInput({ meta: true, key: "f" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "toggle-thread-search", open: false });
  });

  it("does not trigger with Shift held", () => {
    const surface = makeSurface();
    const input = makeInput({ meta: true, shift: true, key: "f" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Diff panel (Cmd+D)
// ---------------------------------------------------------------------------

describe("diff panel toggle", () => {
  it("returns toggle-diff-panel for Cmd+D", () => {
    const surface = makeSurface();
    const input = makeInput({ meta: true, key: "d" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "toggle-diff-panel" });
  });

  it("does not trigger with Shift held", () => {
    const surface = makeSurface();
    const input = makeInput({ meta: true, shift: true, key: "d" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Model picker (Cmd+T)
// ---------------------------------------------------------------------------

describe("model picker", () => {
  it("returns open-model-picker for Cmd+T", () => {
    const surface = makeSurface();
    const input = makeInput({ meta: true, key: "t" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "open-model-picker" });
  });

  it("does not trigger with Shift held", () => {
    const surface = makeSurface();
    const input = makeInput({ meta: true, shift: true, key: "t" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Thinking cycle (Shift+Tab)
// ---------------------------------------------------------------------------

describe("thinking cycle", () => {
  it("returns cycle-thinking for Shift+Tab", () => {
    const surface = makeSurface();
    const input = makeInput({ key: "Tab", shift: true });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "cycle-thinking" });
  });

  it("does not trigger with meta held", () => {
    const surface = makeSurface();
    const input = makeInput({ key: "Tab", shift: true, meta: true });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toBeNull();
  });

  it("does not trigger without shift", () => {
    const surface = makeSurface();
    const input = makeInput({ key: "Tab" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Navigation history (Cmd+[ / Cmd+])
// ---------------------------------------------------------------------------

describe("navigation history", () => {
  it("navigates back when Cmd+[ and history has entry", () => {
    const entry = { activeView: "threads" as const, selectedWorkspaceId: "ws-1", selectedSessionId: "sess-0" };
    const goBack = vi.fn(() => entry);
    const surface = makeSurface({ navigationHistory: { goBack, goForward: vi.fn(() => null) } });
    const input = makeInput({ meta: true, key: "[" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "navigate-back", entry });
    expect(goBack).toHaveBeenCalledOnce();
  });

  it("returns null when Cmd+[ and history is empty", () => {
    const goBack = vi.fn(() => null);
    const surface = makeSurface({ navigationHistory: { goBack, goForward: vi.fn(() => null) } });
    const input = makeInput({ meta: true, key: "[" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toBeNull();
  });

  it("navigates forward when Cmd+] and history has entry", () => {
    const entry = { activeView: "settings" as const, selectedWorkspaceId: "ws-2", selectedSessionId: "sess-2" };
    const goForward = vi.fn(() => entry);
    const surface = makeSurface({ navigationHistory: { goBack: vi.fn(() => null), goForward } });
    const input = makeInput({ meta: true, key: "]" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "navigate-forward", entry });
    expect(goForward).toHaveBeenCalledOnce();
  });

  it("does not trigger Cmd+[ with shift held", () => {
    const surface = makeSurface();
    const input = makeInput({ meta: true, shift: true, key: "[" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Command-based shortcuts
// ---------------------------------------------------------------------------

describe("command-based shortcuts", () => {
  it("open-settings returns root workspace ID", () => {
    const surface = makeSurface({ rootWorkspaceId: "root-42" });
    const input = makeInput({ command: "open-settings" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "open-settings", workspaceId: "root-42" });
  });

  it("open-new-thread returns root workspace ID", () => {
    const surface = makeSurface({ rootWorkspaceId: "root-99" });
    const input = makeInput({ command: "open-new-thread" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "open-new-thread", workspaceId: "root-99" });
  });

  it("toggle-terminal opens terminal when closed", () => {
    const surface = makeSurface({ terminalSessionKey: "", selectedSessionId: "sess-1" });
    const input = makeInput({ command: "toggle-terminal" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "toggle-terminal", sessionId: "sess-1", open: true });
  });

  it("toggle-terminal closes terminal when open", () => {
    const surface = makeSurface({ terminalSessionKey: "sess-1", selectedSessionId: "sess-1" });
    const input = makeInput({ command: "toggle-terminal" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "toggle-terminal", sessionId: "sess-1", open: false });
  });

  it("toggle-sidebar returns visible when sidebar is collapsed", () => {
    const surface = makeSurface({ activeView: "threads", sidebarCollapsed: true });
    const input = makeInput({ command: "toggle-sidebar" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "toggle-sidebar", visible: true });
  });

  it("toggle-sidebar returns visible when sidebar is expanded", () => {
    const surface = makeSurface({ activeView: "threads", sidebarCollapsed: false });
    const input = makeInput({ command: "toggle-sidebar" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "toggle-sidebar", visible: false });
  });

  it("toggle-sidebar returns visible for settings view", () => {
    const surface = makeSurface({ activeView: "settings" });
    const input = makeInput({ command: "toggle-sidebar" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "toggle-sidebar", visible: false });
  });

  it("toggle-sidebar returns visible for skills view", () => {
    const surface = makeSurface({ activeView: "skills" });
    const input = makeInput({ command: "toggle-sidebar" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "toggle-sidebar", visible: false });
  });

  it("commit-and-push returns commit-and-push intent", () => {
    const surface = makeSurface();
    const input = makeInput({ command: "commit-and-push" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toEqual({ type: "commit-and-push" });
  });
});

// ---------------------------------------------------------------------------
// Unhandled input
// ---------------------------------------------------------------------------

describe("unhandled input", () => {
  it("returns null for no modifier and no command", () => {
    const surface = makeSurface();
    const input = makeInput({ key: "a" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toBeNull();
  });

  it("returns null for unknown command", () => {
    const surface = makeSurface();
    const input = makeInput({ command: "unknown-command" });
    const intent = interpretSurfaceIntent(surface, input);
    expect(intent).toBeNull();
  });
});
