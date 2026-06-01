import { PROTOCOL_VERSION } from "@pi-gui/desktop-protocol";
import type {
  CoreState,
  CoreWorkspaceRecord,
  CoreSessionCommandRecord,
} from "@pi-gui/desktop-core";

/* ── Types ─────────────────────────────────────────── */

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface DesktopClientState {
  readonly connectionStatus: ConnectionStatus;
  readonly connectionError: string | null;
  readonly sidecarPid: number | null;

  readonly workspaces: readonly CoreWorkspaceRecord[];
  readonly selectedWorkspaceId: string | null;
  readonly selectedSessionId: string | null;
  readonly sessionCommandsBySession: Record<
    string,
    readonly CoreSessionCommandRecord[]
  >;
  readonly revision: number;

  readonly transcript: unknown[] | null;
  readonly pendingCommandCount: number;
}

export interface DesktopClientCommands {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendCommand<C extends string>(
    command: C,
    payload?: unknown,
  ): Promise<unknown>;
  subscribeSession(
    workspaceId: string,
    sessionId: string,
  ): Promise<void>;
}

export interface DesktopClientStore {
  readonly state: DesktopClientState;
  readonly commands: DesktopClientCommands;
  /** Subscribe to every state change. Returns unsubscribe function. */
  subscribe(listener: (state: DesktopClientState) => void): () => void;
}

/* ── Helpers ──────────────────────────────────────── */

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const COMMAND_TIMEOUT_MS = 30_000;

function genCommandId(): string {
  return `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Factory ──────────────────────────────────────── */

export interface CreateDesktopClientOptions {
  /** Factory for creating WebSocket connections. Defaults to globalThis.WebSocket. */
  webSocketFactory?: (url: string) => WebSocket;
  /** How to get sidecar connection info. Defaults to Tauri bridge. */
  getSidecarConnection?: () => Promise<{ port: number; token: string }>;
}

export function createDesktopClientStore(
  options?: CreateDesktopClientOptions,
): DesktopClientStore {
  const wsFactory =
    options?.webSocketFactory ??
    ((url: string) => new globalThis.WebSocket(url));
  const getConnection =
    options?.getSidecarConnection ?? getTauriConnection;

  /* ── Internal state ──────────────────────────── */

  let connectionStatus: ConnectionStatus = "disconnected";
  let connectionError: string | null = null;
  let sidecarPid: number | null = null;

  let workspaces: CoreWorkspaceRecord[] = [];
  let selectedWorkspaceId: string | null = null;
  let selectedSessionId: string | null = null;
  let sessionCommandsBySession: Record<
    string,
    readonly CoreSessionCommandRecord[]
  > = {};
  let revision = 0;

  let transcript: unknown[] | null = null;
  let pendingCommandCount = 0;

  let ws: WebSocket | null = null;
  const pending = new Map<string, PendingCommand>();
  let _token = "";
  let reconnectDelay = 1000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const listeners = new Set<(s: DesktopClientState) => void>();

  /* ── Snapshot ─────────────────────────────────── */

  function snapshot(): DesktopClientState {
    return {
      connectionStatus,
      connectionError,
      sidecarPid,
      workspaces,
      selectedWorkspaceId,
      selectedSessionId,
      sessionCommandsBySession,
      revision,
      transcript,
      pendingCommandCount,
    };
  }

  function emit(): void {
    const snap = snapshot();
    for (const l of listeners) {
      try {
        l(snap);
      } catch {
        /* swallow */
      }
    }
  }

  /* ── State read ───────────────────────────────── */

  const state: DesktopClientState = {
    get connectionStatus() {
      return connectionStatus;
    },
    get connectionError() {
      return connectionError;
    },
    get sidecarPid() {
      return sidecarPid;
    },
    get workspaces() {
      return workspaces;
    },
    get selectedWorkspaceId() {
      return selectedWorkspaceId;
    },
    get selectedSessionId() {
      return selectedSessionId;
    },
    get sessionCommandsBySession() {
      return sessionCommandsBySession;
    },
    get revision() {
      return revision;
    },
    get transcript() {
      return transcript;
    },
    get pendingCommandCount() {
      return pendingCommandCount;
    },
  };

  /* ── Connection ──────────────────────────────── */

  async function connect(): Promise<void> {
    if (disposed) return;
    if (
      connectionStatus === "connecting" ||
      connectionStatus === "connected"
    ) {
      return;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    connectionStatus = "connecting";
    connectionError = null;
    emit();

    try {
      const conn = await getConnection();
      _token = conn.token;
      const url = `ws://127.0.0.1:${conn.port}`;

      ws = wsFactory(url);
      ws.onopen = () => {
        ws!.send(
          JSON.stringify({
            type: "client-hello",
            version: PROTOCOL_VERSION,
            token: _token,
          }),
        );
      };

      ws.onmessage = (event) => {
        handleMessage(
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer),
        );
      };

      ws.onclose = (event) => {
        cleanupWs();
        if (!disposed && event.code !== 1000) {
          scheduleReconnect();
        }
        emit();
      };

      ws.onerror = () => {
        // onclose fires after onerror; handle there
      };
    } catch (err) {
      connectionStatus = "error";
      connectionError = err instanceof Error ? err.message : String(err);
      emit();
      if (!disposed) {
        scheduleReconnect();
      }
    }
  }

  async function disconnect(): Promise<void> {
    disposed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close(1000);
      ws = null;
    }
    cleanupWs();
    connectionStatus = "disconnected";
    emit();
  }

  function cleanupWs(): void {
    // Reject all pending commands
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Connection lost"));
    }
    pending.clear();
    pendingCommandCount = 0;
    ws = null;
  }

  function scheduleReconnect(): void {
    if (disposed || reconnectTimer) return;
    connectionStatus = "error";
    emit();
    reconnectTimer = setTimeout(
      () => {
        reconnectTimer = null;
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
        void connect();
      },
      reconnectDelay,
    );
  }

  /* ── Message handling ──────────────────────────── */

  function handleMessage(data: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    const type = parsed.type as string | undefined;

    switch (type) {
      case "server-ready": {
        connectionStatus = "connected";
        connectionError = null;
        sidecarPid = parsed.sidecarPid as number;
        reconnectDelay = 1000;
        emit();
        break;
      }

      case "auth-rejected": {
        connectionStatus = "error";
        connectionError = `Auth rejected: ${String(parsed.reason ?? "unknown")}`;
        emit();
        ws?.close();
        break;
      }

      case "server-error": {
        const cmdId = parsed.commandId as string | undefined;
        if (cmdId) {
          const p = pending.get(cmdId);
          if (p) {
            clearTimeout(p.timer);
            pending.delete(cmdId);
            pendingCommandCount = pending.size;
            emit();
            p.reject(
              new Error(
                (parsed.message as string) ?? "Server error",
              ),
            );
          }
        }
        break;
      }

      case "command-result": {
        const cmdId = parsed.id as string | undefined;
        if (cmdId) {
          const p = pending.get(cmdId);
          if (p) {
            clearTimeout(p.timer);
            pending.delete(cmdId);
            pendingCommandCount = pending.size;
            emit();
            p.resolve(parsed.result);
          }
        }
        break;
      }

      case "event": {
        const eventName = parsed.event as string | undefined;
        const payload = parsed.payload;
        handleEvent(eventName, payload);
        break;
      }
    }
  }

  function handleEvent(
    eventName: string | undefined,
    payload: unknown,
  ): void {
    switch (eventName) {
      case "state.snapshot":
      case "state.changed": {
        const snap = payload as CoreState | undefined;
        if (snap) {
          workspaces = (snap.workspaces ?? []) as CoreWorkspaceRecord[];
          selectedWorkspaceId = snap.selectedWorkspaceId ?? null;
          selectedSessionId = snap.selectedSessionId ?? null;
          sessionCommandsBySession =
            (snap.sessionCommandsBySession as Record<
              string,
              readonly CoreSessionCommandRecord[]
            >) ?? {};
          revision = snap.revision ?? 0;
        }
        emit();
        break;
      }

      case "transcript.appended": {
        const t = payload as {
          workspaceId?: string;
          message?: unknown;
        } | null;
        if (t?.message != null) {
          transcript = [...(transcript ?? []), t.message];
          emit();
        }
        break;
      }

      case "session.event": {
        const se = payload as {
          workspaceId?: string;
          sessionId?: string;
          event?: { kind?: string; data?: unknown };
        } | null;
        if (se?.event?.kind === "stream") {
          transcript = [...(transcript ?? []), se.event.data];
          emit();
        }
        break;
      }

      case "selectedTranscript.changed": {
        const t = payload as {
          transcript?: unknown[];
        } | null;
        if (t) {
          transcript = (t.transcript as unknown[]) ?? [];
          emit();
        }
        break;
      }

      case "app.error": {
        const ae = payload as { message?: string } | null;
        if (ae?.message) {
          connectionError = ae.message;
          emit();
        }
        break;
      }
    }
  }

  /* ── Commands ───────────────────────────────────── */

  async function sendCommand<C extends string>(
    command: C,
    payload?: unknown,
  ): Promise<unknown> {
    if (!ws || ws.readyState !== ws.OPEN) {
      throw new Error("Not connected to sidecar");
    }

    const id = genCommandId();

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        pendingCommandCount = pending.size;
        emit();
        reject(new Error(`Command timed out: ${command}`));
      }, COMMAND_TIMEOUT_MS);

      pending.set(id, { resolve, reject, timer });
      pendingCommandCount = pending.size;
      emit();

      ws!.send(
        JSON.stringify({ type: "command", id, command, payload }),
      );
    });
  }

  async function subscribeSession(
    workspaceId: string,
    sessionId: string,
  ): Promise<void> {
    await sendCommand("session.subscribe", {
      workspaceId,
      sessionId,
    });
  }

  const commands: DesktopClientCommands = {
    connect,
    disconnect,
    sendCommand,
    subscribeSession,
  };

  function subscribe(
    listener: (state: DesktopClientState) => void,
  ): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return { state, commands, subscribe };
}

/* ── Tauri bridge (default) ────────────────────────── */

async function getTauriConnection(): Promise<{
  port: number;
  token: string;
}> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke("get_sidecar_connection")) as {
      port: number;
      token: string;
    };
  } catch {
    throw new Error(
      "Tauri bridge unavailable — are you running inside Tauri?",
    );
  }
}
