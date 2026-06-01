import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { PROTOCOL_VERSION } from "@pi-gui/desktop-protocol";
import { createDesktopClientStore } from "../src/lib/desktop-client.js";
import type { DesktopClientStore } from "../src/lib/desktop-client.js";

/* ── Minimal MockWebSocket ────────────────────────── */

class MockWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly OPEN = 1;

  sent: string[] = [];
  closed = false;

  constructor(public url: string) {
    // Do NOT auto-open — caller controls via manualOpen()
  }

  manualOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receiveMessage(msg: Record<string, unknown>): void {
    if (!this.closed && this.readyState === 1) {
      this.onmessage?.({ data: JSON.stringify(msg) });
    }
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? "" });
  }
}

/* ── Helpers ──────────────────────────────────────── */

function emptyState() {
  return {
    workspaces: [],
    selectedWorkspaceId: null,
    selectedSessionId: null,
    sessionCommandsBySession: {},
    revision: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ── Tests ────────────────────────────────────────── */

describe("desktopClient store", () => {
  let mockWs: MockWebSocket;

  beforeEach(() => {
    mockWs = new MockWebSocket("ws://127.0.0.1:9999");
  });

  /* ── Initial state ──────────────────────────────── */

  it("starts in disconnected state", () => {
    const client = createDesktopClientStore({
      webSocketFactory: () => mockWs as unknown as WebSocket,
      getSidecarConnection: () => Promise.resolve({ port: 9999, token: "tok" }),
    });
    assert.equal(client.state.connectionStatus, "disconnected");
    assert.equal(client.state.connectionError, null);
    assert.equal(client.state.sidecarPid, null);
  });

  /* ── Connection ──────────────────────────────────── */

  it("connects and transitions to connected", async () => {
    const client = createDesktopClientStore({
      webSocketFactory: () => mockWs as unknown as WebSocket,
      getSidecarConnection: () => Promise.resolve({ port: 9999, token: "tok" }),
    });

    const connectPromise = client.commands.connect();
    // Let the async flow run
    await sleep(10);
    // The store is now connecting, socket was created
    assert.equal(client.state.connectionStatus, "connecting");

    // Simulate socket open
    mockWs.manualOpen();
    await sleep(5);

    // Verify client-hello was sent
    const hellos = mockWs.sent.filter((s) => {
      try {
        return JSON.parse(s).type === "client-hello";
      } catch {
        return false;
      }
    });
    assert.equal(hellos.length, 1);
    const hello = JSON.parse(hellos[0]!);
    assert.equal(hello.version, PROTOCOL_VERSION);
    assert.equal(hello.token, "tok");

    // Simulate server-ready
    mockWs.receiveMessage({
      type: "server-ready",
      version: PROTOCOL_VERSION,
      sidecarPid: 42,
    });

    await sleep(5);
    assert.equal(client.state.connectionStatus, "connected");
    assert.equal(client.state.sidecarPid, 42);

    await connectPromise;
  });

  it("handles auth-rejected", async () => {
    const client = createDesktopClientStore({
      webSocketFactory: () => mockWs as unknown as WebSocket,
      getSidecarConnection: () => Promise.resolve({ port: 9999, token: "bad" }),
    });

    const connectPromise = client.commands.connect();
    await sleep(10);
    mockWs.manualOpen();
    await sleep(5);

    mockWs.receiveMessage({
      type: "auth-rejected",
      reason: "Invalid token",
    });

    await sleep(5);
    assert.equal(client.state.connectionStatus, "error");
    assert.ok(client.state.connectionError?.includes("Invalid token"));

    // Don't await connectPromise — it may hang due to reconnect scheduling
  });

  /* ── State snapshot ──────────────────────────────── */

  it("receives state.snapshot event", async () => {
    const client = createDesktopClientStore({
      webSocketFactory: () => mockWs as unknown as WebSocket,
      getSidecarConnection: () => Promise.resolve({ port: 9999, token: "tok" }),
    });

    void client.commands.connect();
    await sleep(10);
    mockWs.manualOpen();
    await sleep(5);

    mockWs.receiveMessage({
      type: "server-ready",
      version: PROTOCOL_VERSION,
      sidecarPid: 1,
    });

    mockWs.receiveMessage({
      type: "event",
      event: "state.snapshot",
      payload: {
        workspaces: [
          {
            id: "ws-1",
            path: "/tmp/p",
            displayName: "p",
            sessions: [
              {
                id: "s-1",
                title: "First",
                status: "idle",
                updatedAt: "2025-01-01T00:00:00Z",
              },
            ],
          },
        ],
        selectedWorkspaceId: "ws-1",
        selectedSessionId: "s-1",
        sessionCommandsBySession: {},
        revision: 3,
      },
    });

    await sleep(5);
    assert.equal(client.state.workspaces.length, 1);
    assert.equal(client.state.workspaces[0]?.id, "ws-1");
    assert.equal(client.state.selectedWorkspaceId, "ws-1");
    assert.equal(client.state.selectedSessionId, "s-1");
    assert.equal(client.state.revision, 3);
  });

  /* ── Commands ────────────────────────────────────── */

  it("sends commands and resolves with result", async () => {
    const client = createDesktopClientStore({
      webSocketFactory: () => mockWs as unknown as WebSocket,
      getSidecarConnection: () => Promise.resolve({ port: 9999, token: "tok" }),
    });

    void client.commands.connect();
    await sleep(10);
    mockWs.manualOpen();
    await sleep(5);

    mockWs.receiveMessage({
      type: "server-ready",
      version: PROTOCOL_VERSION,
      sidecarPid: 1,
    });

    const resultPromise = client.commands.sendCommand("workspace.addPath", {
      path: "/tmp/foo",
    });

    await sleep(5);
    const cmds = mockWs.sent.filter((s) => {
      try {
        return JSON.parse(s).type === "command";
      } catch {
        return false;
      }
    });
    assert.ok(cmds.length >= 1);
    const cmd = JSON.parse(cmds[cmds.length - 1]!);
    assert.equal(cmd.command, "workspace.addPath");

    mockWs.receiveMessage({
      type: "command-result",
      id: cmd.id,
      ok: true,
      result: { success: true },
    });

    const result = await resultPromise;
    assert.deepStrictEqual(result, { success: true });
  });

  it("rejects command on server-error", async () => {
    const client = createDesktopClientStore({
      webSocketFactory: () => mockWs as unknown as WebSocket,
      getSidecarConnection: () => Promise.resolve({ port: 9999, token: "tok" }),
    });

    void client.commands.connect();
    await sleep(10);
    mockWs.manualOpen();
    await sleep(5);

    mockWs.receiveMessage({
      type: "server-ready",
      version: PROTOCOL_VERSION,
      sidecarPid: 1,
    });

    const resultPromise = client.commands.sendCommand("workspace.addPath", {
      path: "/tmp/foo",
    });

    await sleep(5);
    const cmds = mockWs.sent.filter(
      (s) => JSON.parse(s).type === "command",
    );
    const cmd = JSON.parse(cmds[cmds.length - 1]!);

    mockWs.receiveMessage({
      type: "server-error",
      commandId: cmd.id,
      message: "Something went wrong",
    });

    await assert.rejects(resultPromise, /Something went wrong/);
  });

  it("rejects sendCommand when not connected", async () => {
    const client = createDesktopClientStore({
      webSocketFactory: () => mockWs as unknown as WebSocket,
      getSidecarConnection: () => Promise.resolve({ port: 9999, token: "tok" }),
    });

    await assert.rejects(
      client.commands.sendCommand("workspace.addPath", { path: "/tmp/foo" }),
      /Not connected/,
    );
  });

  /* ── Event handling ──────────────────────────────── */

  it("handles transcript.appended event", async () => {
    const client = createDesktopClientStore({
      webSocketFactory: () => mockWs as unknown as WebSocket,
      getSidecarConnection: () => Promise.resolve({ port: 9999, token: "tok" }),
    });

    void client.commands.connect();
    await sleep(10);
    mockWs.manualOpen();
    await sleep(5);
    mockWs.receiveMessage({
      type: "server-ready",
      version: PROTOCOL_VERSION,
      sidecarPid: 1,
    });

    mockWs.receiveMessage({
      type: "event",
      event: "transcript.appended",
      payload: {
        workspaceId: "ws-1",
        message: { role: "user", content: "hello" },
      },
    });

    await sleep(5);
    assert.equal(client.state.transcript?.length, 1);
    assert.deepStrictEqual((client.state.transcript as any[])[0], {
      role: "user",
      content: "hello",
    });
  });

  it("handles session.event stream kinds", async () => {
    const client = createDesktopClientStore({
      webSocketFactory: () => mockWs as unknown as WebSocket,
      getSidecarConnection: () => Promise.resolve({ port: 9999, token: "tok" }),
    });

    void client.commands.connect();
    await sleep(10);
    mockWs.manualOpen();
    await sleep(5);
    mockWs.receiveMessage({
      type: "server-ready",
      version: PROTOCOL_VERSION,
      sidecarPid: 1,
    });

    mockWs.receiveMessage({
      type: "event",
      event: "session.event",
      payload: {
        workspaceId: "ws-1",
        sessionId: "s-1",
        event: { kind: "stream", data: { role: "assistant", content: "hi" } },
      },
    });

    await sleep(5);
    assert.equal(client.state.transcript?.length, 1);
  });

  it("handles selectedTranscript.changed event", async () => {
    const client = createDesktopClientStore({
      webSocketFactory: () => mockWs as unknown as WebSocket,
      getSidecarConnection: () => Promise.resolve({ port: 9999, token: "tok" }),
    });

    void client.commands.connect();
    await sleep(10);
    mockWs.manualOpen();
    await sleep(5);
    mockWs.receiveMessage({
      type: "server-ready",
      version: PROTOCOL_VERSION,
      sidecarPid: 1,
    });

    mockWs.receiveMessage({
      type: "event",
      event: "selectedTranscript.changed",
      payload: {
        transcript: [{ role: "user", content: "q" }],
      },
    });

    await sleep(5);
    assert.equal(client.state.transcript?.length, 1);
  });

  it("handles app.error event", async () => {
    const client = createDesktopClientStore({
      webSocketFactory: () => mockWs as unknown as WebSocket,
      getSidecarConnection: () => Promise.resolve({ port: 9999, token: "tok" }),
    });

    void client.commands.connect();
    await sleep(10);
    mockWs.manualOpen();
    await sleep(5);
    mockWs.receiveMessage({
      type: "server-ready",
      version: PROTOCOL_VERSION,
      sidecarPid: 1,
    });

    mockWs.receiveMessage({
      type: "event",
      event: "app.error",
      payload: { message: "Something broke" },
    });

    await sleep(5);
    assert.equal(client.state.connectionError, "Something broke");
  });

  /* ── Disconnect ──────────────────────────────────── */

  it("disconnects cleanly", async () => {
    const client = createDesktopClientStore({
      webSocketFactory: () => mockWs as unknown as WebSocket,
      getSidecarConnection: () => Promise.resolve({ port: 9999, token: "tok" }),
    });

    void client.commands.connect();
    await sleep(10);
    mockWs.manualOpen();
    await sleep(5);
    mockWs.receiveMessage({
      type: "server-ready",
      version: PROTOCOL_VERSION,
      sidecarPid: 1,
    });

    await sleep(5);
    assert.equal(client.state.connectionStatus, "connected");

    await client.commands.disconnect();
    assert.equal(client.state.connectionStatus, "disconnected");
  });

  /* ── subscribeSession ────────────────────────────── */

  it("sends session.subscribe command", async () => {
    const client = createDesktopClientStore({
      webSocketFactory: () => mockWs as unknown as WebSocket,
      getSidecarConnection: () => Promise.resolve({ port: 9999, token: "tok" }),
    });

    void client.commands.connect();
    await sleep(10);
    mockWs.manualOpen();
    await sleep(5);
    mockWs.receiveMessage({
      type: "server-ready",
      version: PROTOCOL_VERSION,
      sidecarPid: 1,
    });

    const subPromise = client.commands.subscribeSession("ws-1", "s-1");
    await sleep(5);

    const cmds = mockWs.sent.filter(
      (s) => {
        try {
          return JSON.parse(s).command === "session.subscribe";
        } catch {
          return false;
        }
      },
    );
    assert.equal(cmds.length, 1);

    const cmd = JSON.parse(cmds[0]!);
    mockWs.receiveMessage({
      type: "command-result",
      id: cmd.id,
      ok: true,
      result: { subscribed: true },
    });

    await subPromise;
    // subscribeSession returns void
  });

  /* ── Subscription ────────────────────────────────── */

  it("notifies subscribers on state change", async () => {
    const client = createDesktopClientStore({
      webSocketFactory: () => mockWs as unknown as WebSocket,
      getSidecarConnection: () => Promise.resolve({ port: 9999, token: "tok" }),
    });

    const states: string[] = [];
    client.subscribe((s) => {
      states.push(s.connectionStatus);
    });

    void client.commands.connect();
    await sleep(10);
    // Should have emitted "connecting"
    assert.ok(states.includes("connecting"));

    mockWs.manualOpen();
    await sleep(5);

    mockWs.receiveMessage({
      type: "server-ready",
      version: PROTOCOL_VERSION,
      sidecarPid: 1,
    });

    await sleep(5);
    assert.ok(states.includes("connected"));
  });
});
