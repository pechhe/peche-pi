import * as v from "valibot";
import {
  DesktopAppStateSchema,
  SelectedTranscriptRecordSchema,
  WorkspaceIdSchema,
} from "./schemas.js";

/**
 * Server-emitted events. Each event has a Valibot schema for its payload.
 *
 * State sync contract:
 *   - On connect, the client requests `snapshot.getState` to receive the
 *     full state. After that, the server pushes `state.changed` deltas
 *     (the entire state, since the canonical model is opaque to the client).
 *   - On reconnect or version mismatch, the client requests a fresh
 *     snapshot and resubscribes.
 */

export const EventSchemas = {
  "state.changed": DesktopAppStateSchema,
  "state.snapshot": DesktopAppStateSchema,
  "selectedTranscript.changed": v.nullable(SelectedTranscriptRecordSchema),
  "transcript.appended": v.object({
    workspaceId: WorkspaceIdSchema,
    sessionId: v.string(),
    message: v.unknown(),
  }),
  "runtime.changed": v.object({
    workspaceId: WorkspaceIdSchema,
    snapshot: v.unknown(),
  }),
  "session.event": v.object({
    workspaceId: WorkspaceIdSchema,
    sessionId: v.string(),
    event: v.unknown(),
  }),
  "workspace.picked": v.object({ workspaceId: WorkspaceIdSchema }),
  "theme.changed": v.object({ mode: v.picklist(["system", "light", "dark"]) }),
  "app.error": v.object({ message: v.string() }),
} as const;

export type EventName = keyof typeof EventSchemas;

export type EventPayload<E extends EventName> = v.InferOutput<(typeof EventSchemas)[E]>;
