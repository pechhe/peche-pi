import * as v from "valibot";

/**
 * Lightweight Valibot schemas for command payloads. Kept separate from the
 * envelope/result schemas to avoid pulling the heavier `desktop-state` type
 * tree into a transport-only package.
 */

const nonEmptyString = v.pipe(v.string(), v.minLength(1));

export const WorkspaceIdSchema = nonEmptyString;
export const SessionIdSchema = nonEmptyString;

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

export const SessionConfigSchema = v.object({
  provider: v.optional(v.string()),
  modelId: v.optional(v.string()),
  thinkingLevel: v.optional(v.string()),
});

export const ModelSettingsSnapshotSchema = v.object({
  defaultProvider: v.optional(v.string()),
  defaultModelId: v.optional(v.string()),
  defaultThinkingLevel: v.optional(v.string()),
  enabledModelPatterns: v.array(v.string()),
});

export const CreateSessionInputLikeSchema = v.object({
  workspaceId: WorkspaceIdSchema,
  title: v.optional(v.string()),
});

export const StartThreadInputLikeSchema = v.object({
  rootWorkspaceId: WorkspaceIdSchema,
  environment: v.picklist(["local", "worktree"]),
  prompt: v.optional(v.string()),
  attachments: v.optional(v.array(ComposerAttachmentSchema)),
  provider: v.optional(v.string()),
  modelId: v.optional(v.string()),
  thinkingLevel: v.optional(v.string()),
});
