import { randomBytes } from "node:crypto";
import * as v from "valibot";
import { WebSocketServer, type WebSocket } from "ws";
import {
  type CommandName,
  ClientHelloSchema,
  PROTOCOL_VERSION,
  parseClientCommand,
} from "@pi-gui/desktop-protocol";
import type { DesktopCore } from "@pi-gui/desktop-core";
import { DesktopCoreImpl } from "@pi-gui/desktop-core";

export interface SidecarServerOptions {
  readonly port?: number;
  readonly token?: string;
  readonly dataDir: string;
  readonly workspacePaths?: readonly string[];
}

export interface SidecarServer {
  readonly port: number;
  readonly token: string;
  readonly core: DesktopCore;
  stop(): Promise<void>;
}

interface ClientState {
  ws: WebSocket;
  authenticated: boolean;
}

export async function startSidecarServer(
  options: SidecarServerOptions,
): Promise<SidecarServer> {
  const token = options.token ?? randomBytes(32).toString("hex");

  const coreOpts: { dataDir: string; initialWorkspacePaths?: readonly string[] } = {
    dataDir: options.dataDir,
  };
  if (options.workspacePaths) {
    coreOpts.initialWorkspacePaths = options.workspacePaths;
  }
  const core = new DesktopCoreImpl(coreOpts);
  await core.initialize();

  return new Promise<SidecarServer>((resolve, reject) => {
    const wss = new WebSocketServer({
      host: "127.0.0.1",
      port: options.port ?? 0,
    });

    wss.once("listening", () => {
      const addr = wss.address();
      if (!addr || typeof addr !== "object") {
        reject(new Error("WebSocket server started but address unavailable"));
        return;
      }

      wss.on("connection", (ws: WebSocket) => {
        const client: ClientState = { ws, authenticated: false };
        const unsubs: Array<() => void> = [];

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
              : undefined;
          if (!str) {
            sendError(ws, "", "Invalid message format");
            return;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(str);
          } catch {
            sendError(ws, "", "Invalid JSON");
            return;
          }

          if (!client.authenticated) {
            handleAuth(ws, client, token, parsed, core);
            return;
          }

          void handleCommand(ws, core, unsubs, parsed);
        });

        ws.on("close", () => {
          for (const unsub of unsubs) {
            try {
              unsub();
            } catch {
              /* ignore */
            }
          }
          unsubs.length = 0;
        });
      });

      resolve({
        port: addr.port,
        token,
        core,
        stop: () =>
          Promise.all([core.flushPersistence(), closeWss(wss)]).then(() => {}),
      });
    });

    wss.once("error", reject);
  });
}

/* ── Auth ──────────────────────────────────────────────── */

function handleAuth(
  ws: WebSocket,
  client: ClientState,
  token: string,
  parsed: unknown,
  core: DesktopCore,
): void {
  // Quick version/token check before full schema parse
  const p = parsed as Record<string, unknown> | null;
  if (!p || p.type !== "client-hello") {
    sendError(ws, "", "Authentication required — send client-hello first");
    return;
  }

  const version = p.version;
  if (version !== PROTOCOL_VERSION) {
    ws.send(
      JSON.stringify({
        type: "auth-rejected",
        reason: `Unsupported protocol version: ${String(version)}, expected ${PROTOCOL_VERSION}`,
      }),
    );
    ws.close();
    return;
  }

  const clientToken = p.token;
  if (clientToken !== token) {
    ws.send(
      JSON.stringify({
        type: "auth-rejected",
        reason: "Invalid authentication token",
      }),
    );
    ws.close();
    return;
  }

  // Full validation for completeness
  const result = v.safeParse(ClientHelloSchema, parsed);
  if (!result.success) {
    sendError(ws, "", "Malformed client-hello");
    return;
  }

  client.authenticated = true;
  ws.send(
    JSON.stringify({
      type: "server-ready",
      version: PROTOCOL_VERSION,
      sidecarPid: process.pid,
    }),
  );

  // Send initial state snapshot after auth
  ws.send(
    JSON.stringify({
      type: "event",
      event: "state.snapshot",
      payload: core.state,
    }),
  );
}

/* ── Commands ──────────────────────────────────────────── */

async function handleCommand(
  ws: WebSocket,
  core: DesktopCore,
  unsubs: Array<() => void>,
  parsed: unknown,
): Promise<void> {
  let cmd: { id: string; command: string; payload: unknown };
  try {
    cmd = parseClientCommand(parsed);
  } catch {
    sendError(ws, "", "Invalid command envelope");
    return;
  }

  try {
    const result = await executeCommand(core, cmd.command, cmd.payload, unsubs, ws);
    ws.send(
      JSON.stringify({ type: "command-result", id: cmd.id, ok: true, result }),
    );
  } catch (err) {
    ws.send(
      JSON.stringify({
        type: "server-error",
        commandId: cmd.id,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

async function executeCommand(
  core: DesktopCore,
  command: string,
  payload: unknown,
  _unsubs: Array<() => void>,
  ws: WebSocket,
): Promise<unknown> {
  const p = payload as Record<string, unknown> | undefined;

  switch (command) {
    case "snapshot.getState":
      return core.state;

    case "snapshot.getSelectedTranscript": {
      const wsId = core.state.selectedWorkspaceId;
      const sessId = core.state.selectedSessionId;
      if (!wsId || !sessId) return null;
      const transcript = await core.getTranscript({
        workspaceId: wsId,
        sessionId: sessId,
      });
      return { workspaceId: wsId, sessionId: sessId, transcript };
    }

    case "workspace.addPath":
      return core.addWorkspace((p as { path: string }).path);

    case "workspace.select":
      return core.selectWorkspace((p as { workspaceId: string }).workspaceId);

    case "workspace.remove":
      return core.removeWorkspace((p as { workspaceId: string }).workspaceId);

    case "session.create":
      return core.createSession(
        (p as { workspaceId?: string })?.workspaceId ??
          core.state.selectedWorkspaceId ??
          "",
      );

    case "session.select": {
      const t = p as { workspaceId: string; sessionId: string };
      return core.selectSession({
        workspaceId: t.workspaceId,
        sessionId: t.sessionId,
      });
    }

    case "session.archive": {
      const t = p as { workspaceId: string; sessionId: string };
      return core.archiveSession({
        workspaceId: t.workspaceId,
        sessionId: t.sessionId,
      });
    }

    case "session.unarchive": {
      const t = p as { workspaceId: string; sessionId: string };
      return core.unarchiveSession({
        workspaceId: t.workspaceId,
        sessionId: t.sessionId,
      });
    }

    case "session.cancelCurrentRun": {
      const wsId = core.state.selectedWorkspaceId;
      const sessId = core.state.selectedSessionId;
      if (!wsId || !sessId) throw new Error("No active session");
      await core.cancelRun({ workspaceId: wsId, sessionId: sessId });
      return { cancelled: true };
    }

    case "composer.submit": {
      const wsId = core.state.selectedWorkspaceId;
      const sessId = core.state.selectedSessionId;
      if (!wsId || !sessId) throw new Error("No active session");
      await core.submitMessage(
        { workspaceId: wsId, sessionId: sessId },
        (p as { text: string }).text,
      );
      return { submitted: true };
    }

    case "model.setDefaultModel": {
      const t = p as { workspaceId: string; provider: string; modelId: string };
      return core.setDefaultModel(t.workspaceId, t.provider, t.modelId);
    }

    case "model.setSessionThinkingLevel": {
      const t = p as {
        workspaceId: string;
        sessionId: string;
        thinkingLevel: string;
      };
      return core.setSessionThinkingLevel(
        { workspaceId: t.workspaceId, sessionId: t.sessionId },
        t.thinkingLevel,
      );
    }

    case "shutdown":
      return { shuttingDown: true };

    case "session.subscribe": {
      const t = p as { workspaceId: string; sessionId: string };
      const sessionRef = {
        workspaceId: t.workspaceId,
        sessionId: t.sessionId,
      };
      const unsub = core.subscribe(sessionRef, (event) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(
            JSON.stringify({
              type: "event",
              event: "session.event",
              payload: {
                workspaceId: t.workspaceId,
                sessionId: t.sessionId,
                event,
              },
            }),
          );
        }
      });
      _unsubs.push(unsub);
      return { subscribed: true };
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

/* ── Helpers ──────────────────────────────────────────── */

function sendError(ws: WebSocket, commandId: string, message: string): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: "server-error", commandId, message }));
  }
}

function closeWss(wss: WebSocketServer): Promise<void> {
  return new Promise<void>((resolve) => {
    wss.close(() => resolve());
  });
}
