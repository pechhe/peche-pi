/**
 * Integration tests for the Sidecar WebSocket server.
 *
 * These tests start a real Sidecar server on a random port and
 * connect to it using the `ws` client, exercising the auth handshake
 * and command dispatch.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import WebSocket from "ws";
import {
  startSidecarServer,
  type SidecarServer,
} from "../src/ws-server.js";

/** Wait for a WebSocket to reach a given readyState. */
function wsReady(ws: WebSocket, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === ws.OPEN) return resolve();
    const timer = setTimeout(
      () => reject(new Error("WebSocket open timeout")),
      timeoutMs,
    );
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Send a JSON message and wait for one response. */
function wsRequest(
  ws: WebSocket,
  message: unknown,
  timeoutMs = 5000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("WebSocket response timeout")),
      timeoutMs,
    );
    const handler = (raw: unknown) => {
      clearTimeout(timer);
      ws.off("message", handler);
      const buf = raw instanceof Buffer ? raw : Buffer.isBuffer(raw) ? raw : undefined;
      const str = buf ? buf.toString("utf8") : typeof raw === "string" ? raw : "";
      try {
        resolve(JSON.parse(str));
      } catch {
        reject(new Error("Invalid JSON response"));
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify(message));
  });
}

async function connect(
  port: number,
): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await wsReady(ws);
  return ws;
}

describe("Sidecar WebSocket server", () => {
  let dataDir: string;
  let server: SidecarServer;

  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "pi-sidecar-ws-test-"));
    server = await startSidecarServer({ dataDir });
  });

  after(async () => {
    await server.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("rejects commands before client-hello", async () => {
    const ws = await connect(server.port);
    const resp = await wsRequest(ws, {
      type: "command",
      id: "1",
      command: "snapshot.getState",
      payload: {},
    });
    assert.equal(
      (resp as { type: string }).type,
      "server-error",
      "should get server-error before auth",
    );
    ws.close();
  });

  it("rejects invalid token", async () => {
    const ws = await connect(server.port);
    const resp = await wsRequest(ws, {
      type: "client-hello",
      version: 1,
      token: "wrong-token",
    });
    assert.equal(
      (resp as { type: string }).type,
      "auth-rejected",
    );
    ws.close();
  });

  it("rejects wrong protocol version", async () => {
    const ws = await connect(server.port);
    const resp = await wsRequest(ws, {
      type: "client-hello",
      version: 999,
      token: server.token,
    });
    assert.equal(
      (resp as { type: string }).type,
      "auth-rejected",
    );
    ws.close();
  });

  it("completes handshake with valid token", async () => {
    const ws = await connect(server.port);
    const resp = await wsRequest(ws, {
      type: "client-hello",
      version: 1,
      token: server.token,
    });
    assert.equal(
      (resp as { type: string; version: number }).type,
      "server-ready",
    );
    assert.equal((resp as { version: number }).version, 1);
    ws.close();
  });

  it("snapshot.getState returns state after auth", async () => {
    const ws = await connect(server.port);
    await wsRequest(ws, {
      type: "client-hello",
      version: 1,
      token: server.token,
    });

    const resp = await wsRequest(ws, {
      type: "command",
      id: "1",
      command: "snapshot.getState",
      payload: {},
    });

    const body = resp as { type: string; result: { workspaces: unknown[] } };
    assert.equal(body.type, "command-result");
    assert.ok(Array.isArray(body.result.workspaces));
    ws.close();
  });

  it("returns error for unknown command", async () => {
    const ws = await connect(server.port);
    await wsRequest(ws, {
      type: "client-hello",
      version: 1,
      token: server.token,
    });

    const resp = await wsRequest(ws, {
      type: "command",
      id: "1",
      command: "unknown.thing",
      payload: {},
    });

    assert.equal(
      (resp as { type: string }).type,
      "server-error",
    );
    ws.close();
  });

  it("snapshot.getSelectedTranscript returns null when no session selected", async () => {
    const ws = await connect(server.port);
    await wsRequest(ws, {
      type: "client-hello",
      version: 1,
      token: server.token,
    });

    const resp = await wsRequest(ws, {
      type: "command",
      id: "2",
      command: "snapshot.getSelectedTranscript",
      payload: {},
    });

    const body = resp as { type: string; result: unknown };
    assert.equal(body.type, "command-result");
    assert.equal(body.result, null);
    ws.close();
  });

  it("handles reconnect with fresh snapshot", async () => {
    // First connection: auth + get state
    const ws1 = await connect(server.port);
    await wsRequest(ws1, {
      type: "client-hello",
      version: 1,
      token: server.token,
    });
    // server-ready + state.snapshot arrive sequentially
    // Skip first response (server-ready), check second (state.snapshot)
    // Actually wsRequest only reads one message, which is server-ready.
    // We need to read past it.
    ws1.close();

    // Second connection: same process
    const ws2 = await connect(server.port);
    const helloResp = await wsRequest(ws2, {
      type: "client-hello",
      version: 1,
      token: server.token,
    });
    assert.equal(
      (helloResp as { type: string }).type,
      "server-ready",
    );
    ws2.close();
  });

  it("receives state.snapshot event after auth", async () => {
    const ws = await connect(server.port);

    // Send client-hello
    ws.send(
      JSON.stringify({
        type: "client-hello",
        version: 1,
        token: server.token,
      }),
    );

    // Read two messages: server-ready then state.snapshot
    const messages: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (messages.length >= 2) {
          resolve();
        } else {
          reject(new Error(`Only got ${messages.length} messages`));
        }
      }, 3000);
      ws.on("message", (raw) => {
        const buf =
          raw instanceof Buffer
            ? raw
            : Buffer.isBuffer(raw)
              ? raw
              : undefined;
        const str = buf
          ? buf.toString("utf8")
          : typeof raw === "string"
            ? raw
            : "";
        messages.push(JSON.parse(str));
        if (messages.length >= 2) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    assert.equal(messages.length, 2);
    assert.equal(
      (messages[0] as { type: string }).type,
      "server-ready",
    );
    assert.equal(
      (messages[1] as { type: string; event: string }).type,
      "event",
    );
    assert.equal(
      (messages[1] as { event: string }).event,
      "state.snapshot",
    );
    ws.close();
  });

  /* ── Persistence across restart ──────────────── */

  it("persists workspace across sidecar restart", async () => {
    const persistDir = mkdtempSync(join(tmpdir(), "pi-sidecar-persist-"));
    const wsDir = mkdtempSync(join(tmpdir(), "pi-test-ws-"));
    try {
      // Start first server
      const server1 = await startSidecarServer({ dataDir: persistDir });
      const ws1 = await connect(server1.port);

      // Auth
      ws1.send(JSON.stringify({
        type: "client-hello",
        version: 1,
        token: server1.token,
      }));

      // Read server-ready + state.snapshot
      await readPastServerReady(ws1);

      // Add workspace
      const addResp = await wsRequest(ws1, {
        type: "command",
        id: "ws-add",
        command: "workspace.addPath",
        payload: { path: wsDir },
      });
      assert.equal((addResp as { type: string }).type, "command-result");

      // Get state to verify
      const listResp = await wsRequest(ws1, {
        type: "command",
        id: "ws-list",
        command: "snapshot.getState",
        payload: {},
      });
      const state = (listResp as { result: { workspaces: { id: string }[] } }).result;
      assert.equal(state.workspaces.length, 1);
      const wsId = state.workspaces[0]!.id;

      // Stop first server
      ws1.close();
      await server1.stop();

      // Start second server with same dataDir — workspace should be restored from catalogs.json
      const server2 = await startSidecarServer({ dataDir: persistDir });
      const ws2 = await connect(server2.port);

      // Auth
      ws2.send(JSON.stringify({
        type: "client-hello",
        version: 1,
        token: server2.token,
      }));
      await readPastServerReady(ws2);

      // Get state — should have workspace restored
      const listResp2 = await wsRequest(ws2, {
        type: "command",
        id: "ws-list2",
        command: "snapshot.getState",
        payload: {},
      });
      const state2 = (listResp2 as { result: { workspaces: { id: string }[] } }).result;
      assert.equal(state2.workspaces.length, 1);
      assert.equal(state2.workspaces[0]!.id, wsId);

      ws2.close();
      await server2.stop();
    } finally {
      rmSync(persistDir, { recursive: true, force: true });
      rmSync(wsDir, { recursive: true, force: true });
    }
  });
});

/** Read past the server-ready message to get to subsequent events. */
async function readPastServerReady(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), 2000);
    const handler = (raw: unknown) => {
      const buf = raw instanceof Buffer ? raw : Buffer.isBuffer(raw) ? raw : undefined;
      const str = buf ? buf.toString("utf8") : typeof raw === "string" ? raw : "";
      try {
        const msg = JSON.parse(str);
        if (msg.type === "server-ready" || msg.type === "event") {
          // Keep reading past server-ready + state.snapshot
          // We need at least the state.snapshot event consumed
          if (msg.type === "event" && msg.event === "state.snapshot") {
            clearTimeout(timer);
            ws.off("message", handler);
            resolve();
          }
        }
      } catch {
        // ignore
      }
    };
    ws.on("message", handler);
  });
}
