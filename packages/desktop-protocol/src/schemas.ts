import * as v from "valibot";
import { PROTOCOL_VERSION } from "./version.js";

/**
 * Protocol version literal. Embedded in envelopes; the sidecar refuses
 * clients that send a different value.
 */
export const ProtocolVersionSchema = v.literal(PROTOCOL_VERSION);

/* ── Shared primitives ─────────────────────────────────────── */

const nonEmptyString = v.pipe(v.string(), v.minLength(1));

export const WorkspaceIdSchema = nonEmptyString;
export const SessionIdSchema = nonEmptyString;
export const TimestampSchema = nonEmptyString;

export const SessionStatusSchema = v.picklist(["idle", "running", "failed"]);
export const AppViewSchema = v.picklist([
  "threads",
  "new-thread",
  "skills",
  "extensions",
  "settings",
]);
export const ThemeModeSchema = v.picklist(["system", "light", "dark"]);

export const WorkspaceSessionTargetSchema = v.object({
  workspaceId: WorkspaceIdSchema,
  sessionId: SessionIdSchema,
});

export const ComposerImageAttachmentSchema = v.object({
  id: nonEmptyString,
  kind: v.literal("image"),
  name: v.string(),
  mimeType: nonEmptyString,
  data: nonEmptyString,
});

export const ComposerFileAttachmentSchema = v.object({
  id: nonEmptyString,
  kind: v.literal("file"),
  name: nonEmptyString,
  mimeType: nonEmptyString,
  fsPath: nonEmptyString,
  sizeBytes: v.optional(v.number()),
});

export const ComposerAttachmentSchema = v.variant("kind", [
  ComposerImageAttachmentSchema,
  ComposerFileAttachmentSchema,
]);

export const QueuedComposerMessageSchema = v.object({
  id: nonEmptyString,
  mode: v.picklist(["steer", "followUp"]),
  text: v.string(),
  attachments: v.array(ComposerAttachmentSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const NotificationPreferencesSchema = v.object({
  backgroundCompletion: v.boolean(),
  backgroundFailure: v.boolean(),
  attentionNeeded: v.boolean(),
});

export const SessionConfigSchema = v.object({
  provider: v.optional(v.string()),
  modelId: v.optional(v.string()),
  thinkingLevel: v.optional(v.string()),
});

export const SessionRecordSchema = v.object({
  id: SessionIdSchema,
  title: v.string(),
  updatedAt: TimestampSchema,
  lastViewedAt: v.optional(TimestampSchema),
  archivedAt: v.optional(TimestampSchema),
  preview: v.string(),
  status: SessionStatusSchema,
  runningSince: v.optional(TimestampSchema),
  hasUnseenUpdate: v.boolean(),
  config: v.optional(SessionConfigSchema),
});

export const WorkspaceRecordSchema = v.object({
  id: WorkspaceIdSchema,
  name: v.string(),
  path: nonEmptyString,
  lastOpenedAt: TimestampSchema,
  kind: v.picklist(["primary", "worktree"]),
  rootWorkspaceId: v.optional(WorkspaceIdSchema),
  branchName: v.optional(v.string()),
  sessions: v.array(SessionRecordSchema),
});

export const ModelSettingsSnapshotSchema = v.object({
  defaultProvider: v.optional(v.string()),
  defaultModelId: v.optional(v.string()),
  defaultThinkingLevel: v.optional(v.string()),
  enabledModelPatterns: v.array(v.string()),
});

export const RuntimeSnapshotSchema = v.object({
  workspaceId: WorkspaceIdSchema,
  providers: v.array(
    v.object({
      id: v.string(),
      label: v.string(),
      authenticated: v.boolean(),
      supportsApiKey: v.boolean(),
      supportsOAuth: v.boolean(),
    }),
  ),
  models: v.array(
    v.object({
      provider: v.string(),
      id: v.string(),
      label: v.string(),
    }),
  ),
  thinkingLevels: v.array(v.string()),
  defaultThinkingLevel: v.optional(v.string()),
});

export const DesktopAppStateSchema = v.object({
  workspaces: v.array(WorkspaceRecordSchema),
  worktreesByWorkspace: v.record(v.string(), v.array(v.unknown())),
  selectedWorkspaceId: v.string(),
  selectedSessionId: v.string(),
  activeView: AppViewSchema,
  composerDraft: v.string(),
  composerDraftSyncSource: v.string(),
  composerDraftSyncNonce: v.number(),
  composerAttachments: v.array(ComposerAttachmentSchema),
  queuedComposerMessages: v.array(QueuedComposerMessageSchema),
  editingQueuedMessageId: v.optional(v.string()),
  runtimeByWorkspace: v.record(v.string(), RuntimeSnapshotSchema),
  sessionCommandsBySession: v.record(v.string(), v.array(v.unknown())),
  sessionExtensionUiBySession: v.record(v.string(), v.unknown()),
  extensionCommandCompatibilityByWorkspace: v.record(v.string(), v.array(v.unknown())),
  notificationPreferences: NotificationPreferencesSchema,
  integratedTerminalShell: v.string(),
  lastViewedAtBySession: v.record(v.string(), TimestampSchema),
  workspaceOrder: v.array(WorkspaceIdSchema),
  modelSettingsScopeMode: v.picklist(["app-global", "per-repo"]),
  globalModelSettings: ModelSettingsSnapshotSchema,
  sidebarCollapsed: v.boolean(),
  enableTransparency: v.boolean(),
  commitPushModel: v.optional(v.string()),
  revision: v.number(),
  lastError: v.optional(v.string()),
});

export const TranscriptMessageSchema = v.unknown();

export const SelectedTranscriptRecordSchema = v.object({
  workspaceId: WorkspaceIdSchema,
  sessionId: SessionIdSchema,
  transcript: v.array(TranscriptMessageSchema),
});

/* ── Envelopes ──────────────────────────────────────────────── */

export const ClientHelloSchema = v.object({
  type: v.literal("client-hello"),
  version: ProtocolVersionSchema,
  token: nonEmptyString,
});

export const ServerReadySchema = v.object({
  type: v.literal("server-ready"),
  version: ProtocolVersionSchema,
  sidecarPid: v.number(),
});

export const ServerAuthRejectedSchema = v.object({
  type: v.literal("auth-rejected"),
  reason: v.string(),
});

export const ServerErrorSchema = v.object({
  type: v.literal("server-error"),
  commandId: nonEmptyString,
  message: v.string(),
});

export const ClientCommandEnvelopeSchema = v.object({
  type: v.literal("command"),
  id: nonEmptyString,
  command: nonEmptyString,
  payload: v.unknown(),
});

export const ServerEventEnvelopeSchema = v.object({
  type: v.literal("event"),
  event: nonEmptyString,
  payload: v.unknown(),
});

export const ServerEnvelopeSchema = v.variant("type", [
  ServerReadySchema,
  ServerAuthRejectedSchema,
  ServerErrorSchema,
  ServerEventEnvelopeSchema,
]);
