/**
 * Headless Desktop Core state shape.
 *
 * A lean projection of the Sidecar-owned canonical state. The full
 * DesktopAppState lives in the Electron renderer; this is the subset
 * the headless core needs for orchestration.
 */
export interface CoreState {
  readonly workspaces: readonly CoreWorkspaceRecord[];
  readonly selectedWorkspaceId: string | null;
  readonly selectedSessionId: string | null;
  readonly sessionCommandsBySession: Record<string, readonly CoreSessionCommandRecord[]>;
  readonly revision: number;
}

export interface CoreWorkspaceRecord {
  readonly id: string;
  readonly path: string;
  readonly displayName: string;
  readonly sessions: readonly CoreSessionRecord[];
}

export interface CoreSessionRecord {
  readonly id: string;
  readonly title: string;
  readonly status: "idle" | "running" | "queued" | "error";
  readonly preview: string | undefined;
  readonly updatedAt: string;
  readonly archivedAt: string | undefined;
}

export interface CoreSessionCommandRecord {
  readonly name: string;
  readonly sourceInfo: { readonly path: string };
}
