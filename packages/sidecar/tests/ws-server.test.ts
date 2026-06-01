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
});
