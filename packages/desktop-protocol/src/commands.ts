import * as v from "valibot";
import {
  ComposerAttachmentSchema,
  CreateSessionInputLikeSchema,
  ModelSettingsSnapshotSchema,
  SessionConfigSchema,
  SessionIdSchema,
  StartThreadInputLikeSchema,
  WorkspaceIdSchema,
} from "./commands-schemas.js";
import { ThemeModeSchema, WorkspaceSessionTargetSchema } from "./schemas.js";

/**
 * Tracer-bullet command catalog.
 *
 * Every command has a string `command` discriminator and a Valibot schema
 * for its `payload`. The client sends envelopes with shape:
 *   { type: "command", id, command, payload }
 *
 * Adding a command here is a contract change. Bump PROTOCOL_VERSION when a
 * schema changes in a way that breaks existing clients.
 */

export const CommandSchemas = {
  // Connection / query
  "snapshot.getState": v.object({}),
  "snapshot.getSelectedTranscript": v.object({}),

  // Workspace
  "workspace.addPath": v.object({ path: v.pipe(v.string(), v.minLength(1)) }),
  "workspace.pickAndAdd": v.object({}),
  "workspace.select": v.object({ workspaceId: WorkspaceIdSchema }),
  "workspace.remove": v.object({ workspaceId: WorkspaceIdSchema }),
  "workspace.rename": v.object({
    workspaceId: WorkspaceIdSchema,
    displayName: v.string(),
  }),
  "workspace.reorder": v.object({ order: v.array(WorkspaceIdSchema) }),
  "workspace.openInFinder": v.object({ workspaceId: WorkspaceIdSchema }),

  // Session
  "session.create": CreateSessionInputLikeSchema,
  "session.startThread": StartThreadInputLikeSchema,
  "session.select": WorkspaceSessionTargetSchema,
  "session.archive": WorkspaceSessionTargetSchema,
  "session.unarchive": WorkspaceSessionTargetSchema,
  "session.cancelCurrentRun": v.object({}),

  // Composer
  "composer.updateDraft": v.object({ draft: v.string() }),
  "composer.addAttachments": v.object({ attachments: v.array(ComposerAttachmentSchema) }),
  "composer.removeAttachment": v.object({ attachmentId: v.string() }),
  "composer.submit": v.object({
    text: v.string(),
    options: v.optional(
      v.object({ deliverAs: v.optional(v.picklist(["steer", "followUp"])) }),
    ),
  }),
  "composer.editQueued": v.object({
    messageId: v.string(),
    currentDraft: v.optional(v.string()),
  }),
  "composer.cancelQueuedEdit": v.object({}),
  "composer.removeQueued": v.object({ messageId: v.string() }),
  "composer.steerQueued": v.object({ messageId: v.string() }),

  // Model
  "model.setSessionModel": v.object({
    workspaceId: WorkspaceIdSchema,
    sessionId: SessionIdSchema,
    provider: v.string(),
    modelId: v.string(),
  }),
  "model.setDefaultModel": v.object({
    workspaceId: WorkspaceIdSchema,
    provider: v.string(),
    modelId: v.string(),
  }),
  "model.setDefaultThinkingLevel": v.object({
    workspaceId: WorkspaceIdSchema,
    thinkingLevel: v.string(),
  }),
  "model.setSessionThinkingLevel": v.object({
    workspaceId: WorkspaceIdSchema,
    sessionId: SessionIdSchema,
    thinkingLevel: v.string(),
  }),
  "model.setScopeMode": v.object({ mode: v.picklist(["app-global", "per-repo"]) }),
  "model.setGlobalSettings": v.object({ settings: ModelSettingsSnapshotSchema }),

  // View / settings
  "view.setActive": v.object({
    activeView: v.picklist(["threads", "new-thread", "skills", "extensions", "settings"]),
  }),
  "view.setSidebarCollapsed": v.object({ collapsed: v.boolean() }),
  "view.setTheme": v.object({ mode: ThemeModeSchema }),
  "view.setTransparency": v.object({ enabled: v.boolean() }),
  "view.setIntegratedTerminalShell": v.object({ shellPath: v.string() }),
  "view.setNotificationPreferences": v.object({
    preferences: v.object({
      backgroundCompletion: v.boolean(),
      backgroundFailure: v.boolean(),
      attentionNeeded: v.boolean(),
    }),
  }),

  // Provider auth
  "auth.loginProvider": v.object({
    workspaceId: WorkspaceIdSchema,
    providerId: v.string(),
  }),
  "auth.logoutProvider": v.object({
    workspaceId: WorkspaceIdSchema,
    providerId: v.string(),
  }),
  "auth.setProviderApiKey": v.object({
    workspaceId: WorkspaceIdSchema,
    providerId: v.string(),
    apiKey: v.string(),
  }),

  // Session config helpers
  "session.setConfig": v.object({
    workspaceId: WorkspaceIdSchema,
    sessionId: SessionIdSchema,
    config: SessionConfigSchema,
  }),
} as const;

export type CommandName = keyof typeof CommandSchemas;

export type CommandPayload<C extends CommandName> = v.InferOutput<
  (typeof CommandSchemas)[C]
>;
