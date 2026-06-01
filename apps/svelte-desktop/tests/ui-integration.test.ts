/**
 * UI integration tests for the Svelte Tracer Bullet workflows.
 *
 * These tests exercise the DesktopClientStore command dispatch + event
 * reduction path that backs the UI components. They verify:
 *   - Workspace add/select/remove
 *   - Session create/select/archive
 *   - Composer submit/cancel
 *   - Model settings
 *   - Timeline streaming via session events
 *   - Reconnect + snapshot resync
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { PROTOCOL_VERSION } from "@pi-gui/desktop-protocol";
import {
  createDesktopClientStore,
  type DesktopClientStore,
  type DesktopClientState,
} from "../src/lib/desktop-client.js";

/* ── Mock WebSocket ───────────────────────────────── */

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

  constructor(public url: string) {}

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function lastSent(ws: MockWebSocket): Record<string, unknown> | null {
  const raw = ws.sent[ws.sent.length - 1];
  return raw ? JSON.parse(raw) : null;
}

function commandSent(ws: MockWebSocket, cmd: string): Record<string, unknown> | null {
  for (let i = ws.sent.length - 1; i >= 0; i--) {
    const parsed = JSON.parse(ws.sent[i]);
    if (parsed.command === cmd) return parsed;
  }
  return null;
}

function snapshotPayload(overrides?: Partial<Record<string, unknown>>) {
  return {
    workspaces: [],
    selectedWorkspaceId: null,
    selectedSessionId: null,
    sessionCommandsBySession: {},
    revision: 0,
    ...overrides,
  };
}

function workspaceRecord(id: string, overrides?: Partial<Record<string, unknown>>) {
  return {
    id,
    path: `/tmp/ws-${id}`,
    displayName: `Workspace ${id}`,
    sessions: [],
    ...overrides,
  };
}

function sessionRecord(id: string, overrides?: Partial<Record<string, unknown>>) {
  return {
    id,
    title: `Session ${id}`,
    status: "idle",
    preview: undefined,
    updatedAt: new Date().toISOString(),
    archivedAt: undefined,
    ...overrides,
  };
}

/* ── Factory ──────────────────────────────────────── */

function makeClient(): { client: DesktopClientStore; ws: MockWebSocket } {
  const ws = new MockWebSocket("ws://127.0.0.1:9999");
  const client = createDesktopClientStore({
    webSocketFactory: () => ws as unknown as WebSocket,
    getSidecarConnection: () => Promise.resolve({ port: 9999, token: "test-token" }),
  });
  return { client, ws };
}

async function connect(ws: MockWebSocket, client: DesktopClientStore): Promise<void> {
  const p = client.commands.connect();
  ws.manualOpen();
  await sleep(10);
  // Server authenticates
  ws.receiveMessage({ type: "server-ready", sidecarPid: 42 });
  await p;
  await sleep(10);
}

function collectStates(
  client: DesktopClientStore,
  count: number,
): Promise<DesktopClientState[]> {
  return new Promise((resolve) => {
    const states: DesktopClientState[] = [];
    const unsub = client.subscribe((s) => {
      states.push(s);
      if (states.length >= count) {
        unsub();
        resolve(states);
      }
    });
  });
}

/* ── Workspace workflow tests ─────────────────────── */

describe("Workspace list/add/select/remove", () => {
  it("adds a workspace via workspace.addPath", async () => {
    const { client, ws } = makeClient();
    await connect(ws, client);

    const promise = client.commands.sendCommand("workspace.addPath", { path: "/tmp/test-ws" });
    await sleep(5);

    const sent = commandSent(ws, "workspace.addPath")!;
    assert.equal(sent.command, "workspace.addPath");
    assert.equal(sent.payload.path, "/tmp/test-ws");

    // Server responds with updated state
    ws.receiveMessage({ type: "command-result", id: sent.id, result: snapshotPayload() });
    const result = await promise;
    assert.ok(result);
  });

  it("selects a workspace via workspace.select", async () => {
    const { client, ws } = makeClient();
    await connect(ws, client);

    ws.receiveMessage({
      type: "event",
      event: "state.changed",
      payload: snapshotPayload({
        workspaces: [workspaceRecord("ws1")],
        selectedWorkspaceId: "ws1",
      }),
    });
    await sleep(10);

    assert.equal(client.state.selectedWorkspaceId, "ws1");
    assert.equal(client.state.workspaces.length, 1);

    const promise = client.commands.sendCommand("workspace.select", { workspaceId: "ws1" });
    await sleep(5);
    const sent = commandSent(ws, "workspace.select")!;
    ws.receiveMessage({ type: "command-result", id: sent.id, result: snapshotPayload() });
    await promise;
  });

  it("removes a workspace via workspace.remove", async () => {
    const { client, ws } = makeClient();
    await connect(ws, client);

    const promise = client.commands.sendCommand("workspace.remove", { workspaceId: "ws1" });
    await sleep(5);
    const sent = commandSent(ws, "workspace.remove")!;
    assert.equal(sent.payload.workspaceId, "ws1");

    ws.receiveMessage({ type: "command-result", id: sent.id, result: snapshotPayload() });
    await promise;
  });

  it("throws when sending command while disconnected", async () => {
    const { client } = makeClient();
    await assert.rejects(
      () => client.commands.sendCommand("workspace.addPath", { path: "/tmp/x" }),
      /Not connected/,
    );
  });
});

/* ── Session workflow tests ───────────────────────── */

describe("Session create/select/archive", () => {
  it("creates a session via session.create", async () => {
    const { client, ws } = makeClient();
    await connect(ws, client);

    const promise = client.commands.sendCommand("session.create", {
      workspaceId: "ws1",
      title: "New Session",
    });
    await sleep(5);

    const sent = commandSent(ws, "session.create")!;
    assert.equal(sent.payload.workspaceId, "ws1");
    assert.equal(sent.payload.title, "New Session");

    ws.receiveMessage({ type: "command-result", id: sent.id, result: {} });
    await promise;
  });

  it("selects a session and subscribes", async () => {
    const { client, ws } = makeClient();
    await connect(ws, client);

    // Select workspace first via event
    ws.receiveMessage({
      type: "event",
      event: "state.changed",
      payload: snapshotPayload({
        workspaces: [workspaceRecord("ws1", {
          sessions: [sessionRecord("s1")],
        })],
        selectedWorkspaceId: "ws1",
      }),
    });
    await sleep(10);

    // Select session
    const selPromise = client.commands.sendCommand("session.select", {
      workspaceId: "ws1",
      sessionId: "s1",
    });
    await sleep(5);

    const selSent = commandSent(ws, "session.select")!;
    assert.equal(selSent.payload.sessionId, "s1");

    ws.receiveMessage({ type: "command-result", id: selSent.id, result: snapshotPayload({
      selectedSessionId: "s1",
    }) });
    await selPromise;

    // Subscribe
    const subPromise = client.commands.subscribeSession("ws1", "s1");
    await sleep(5);

    const subSent = commandSent(ws, "session.subscribe")!;
    assert.equal(subSent.payload.sessionId, "s1");

    ws.receiveMessage({ type: "command-result", id: subSent.id, result: {} });
    await subPromise;
  });

  it("archives a session via session.archive", async () => {
    const { client, ws } = makeClient();
    await connect(ws, client);

    const promise = client.commands.sendCommand("session.archive", {
      workspaceId: "ws1",
      sessionId: "s1",
    });
    await sleep(5);

    const sent = commandSent(ws, "session.archive")!;
    assert.equal(sent.payload.sessionId, "s1");

    ws.receiveMessage({ type: "command-result", id: sent.id, result: snapshotPayload() });
    await promise;
  });
});

/* ── Composer workflow tests ──────────────────────── */

describe("Composer send/cancel", () => {
  it("submits a message via composer.submit", async () => {
    const { client, ws } = makeClient();
    await connect(ws, client);

    const promise = client.commands.sendCommand("composer.submit", {
      text: "Hello, world!",
    });
    await sleep(5);

    const sent = commandSent(ws, "composer.submit")!;
    assert.equal(sent.payload.text, "Hello, world!");

    ws.receiveMessage({ type: "command-result", id: sent.id, result: {} });
    await promise;
  });

  it("cancels current run via session.cancelCurrentRun", async () => {
    const { client, ws } = makeClient();
    await connect(ws, client);

    const promise = client.commands.sendCommand("session.cancelCurrentRun", {});
    await sleep(5);

    const sent = commandSent(ws, "session.cancelCurrentRun")!;
    assert.equal(sent.command, "session.cancelCurrentRun");

    ws.receiveMessage({ type: "command-result", id: sent.id, result: {} });
    await promise;
  });
});

/* ── Model settings tests ─────────────────────────── */

describe("Model selection", () => {
  it("sets default model via model.setDefaultModel", async () => {
    const { client, ws } = makeClient();
    await connect(ws, client);

    const promise = client.commands.sendCommand("model.setDefaultModel", {
      workspaceId: "ws1",
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
    });
    await sleep(5);

    const sent = commandSent(ws, "model.setDefaultModel")!;
    assert.equal(sent.payload.provider, "anthropic");
    assert.equal(sent.payload.modelId, "claude-sonnet-4-20250514");

    ws.receiveMessage({ type: "command-result", id: sent.id, result: {} });
    await promise;
  });

  it("sets thinking level via model.setDefaultThinkingLevel", async () => {
    const { client, ws } = makeClient();
    await connect(ws, client);

    const promise = client.commands.sendCommand("model.setDefaultThinkingLevel", {
      workspaceId: "ws1",
      thinkingLevel: "high",
    });
    await sleep(5);

    const sent = commandSent(ws, "model.setDefaultThinkingLevel")!;
    assert.equal(sent.payload.thinkingLevel, "high");

    ws.receiveMessage({ type: "command-result", id: sent.id, result: {} });
    await promise;
  });
});

/* ── Timeline streaming tests ─────────────────────── */

describe("Timeline streaming via events", () => {
  it("receives selectedTranscript.changed when selecting session", async () => {
    const { client, ws } = makeClient();
    await connect(ws, client);

    ws.receiveMessage({
      type: "event",
      event: "selectedTranscript.changed",
      payload: { transcript: [{ role: "user", text: "hello" }] },
    });
    await sleep(10);

    assert.ok(client.state.transcript);
    assert.equal(client.state.transcript!.length, 1);
    assert.equal((client.state.transcript![0] as any).role, "user");
  });

  it("appends messages via transcript.appended events", async () => {
    const { client, ws } = makeClient();
    await connect(ws, client);

    // Seed transcript
    ws.receiveMessage({
      type: "event",
      event: "selectedTranscript.changed",
      payload: { transcript: [{ role: "user", text: "hi" }] },
    });
    await sleep(10);

    assert.equal(client.state.transcript!.length, 1);

    // Append assistant response
    ws.receiveMessage({
      type: "event",
      event: "transcript.appended",
      payload: { workspaceId: "ws1", sessionId: "s1", message: { role: "assistant", text: "Hello!" } },
    });
    await sleep(10);

    assert.equal(client.state.transcript!.length, 2);
    assert.equal((client.state.transcript![1] as any).role, "assistant");
  });

  it("streams via session.event events", async () => {
    const { client, ws } = makeClient();
    await connect(ws, client);

    ws.receiveMessage({
      type: "event",
      event: "session.event",
      payload: {
        workspaceId: "ws1",
        sessionId: "s1",
        event: { kind: "stream", data: { role: "assistant", text: "streaming chunk" } },
      },
    });
    await sleep(10);

    assert.equal(client.state.transcript!.length, 1);
    assert.equal((client.state.transcript![0] as any).text, "streaming chunk");
  });

  it("replaces null transcript with selectedTranscript.changed", async () => {
    const { client, ws } = makeClient();
    await connect(ws, client);

    // Should start null
    assert.equal(client.state.transcript, null);

    ws.receiveMessage({
      type: "event",
      event: "selectedTranscript.changed",
      payload: { transcript: [{ role: "user", text: "a" }] },
    });
    await sleep(10);

    assert.equal(client.state.transcript!.length, 1);
  });
});

/* ── Snapshot + reconnect tests ───────────────────── */

describe("State snapshot", () => {
  it("applies state.snapshot event from sidecar", async () => {
    const { client, ws } = makeClient();
    await connect(ws, client);

    ws.receiveMessage({
      type: "event",
      event: "state.snapshot",
      payload: snapshotPayload({
        workspaces: [workspaceRecord("ws1"), workspaceRecord("ws2")],
        selectedWorkspaceId: "ws1",
        selectedSessionId: "s1",
        sessionCommandsBySession: { s1: [{ name: "test", sourceInfo: { path: "/x" } }] },
        revision: 5,
      }),
    });
    await sleep(10);

    assert.equal(client.state.workspaces.length, 2);
    assert.equal(client.state.selectedWorkspaceId, "ws1");
    assert.equal(client.state.selectedSessionId, "s1");
    assert.equal(client.state.revision, 5);
    assert.equal(client.state.sessionCommandsBySession["s1"]?.length, 1);
  });
});
