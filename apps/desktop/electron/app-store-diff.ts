/**
 * App Store Diff — thin wrapper delegating to the Workspace Review Module.
 *
 * This file preserves backward-compatible imports for main.ts and other
 * consumers while the real ownership lives in workspace-review.ts.
 *
 * Strangler migration: move real ownership into Workspace Review, keep
 * this as a re-export shim until all callers migrate directly.
 */

import { createWorkspaceReviewModule, defaultGitAdapter, type ChangedFileEntry, type WorkspaceGitInfo } from "./workspace-review";
import type { UndoEditOp, UndoEditsResult } from "../src/ipc";

// Re-export types for backward compatibility
export type { ChangedFileEntry, WorkspaceGitInfo };

const review = createWorkspaceReviewModule(defaultGitAdapter);

// Re-export functions with the same signatures as before.
// Path validation is now centralized inside the Workspace Review Module.

function validateFilePath(workspacePath: string, filePath: string): string {
  // Delegate to module-level validation (kept as named export for any
  // external callers that used it directly).
  const { validateFilePath: validate } = require("./workspace-review") as typeof import("./workspace-review");
  return validate(workspacePath, filePath);
}

export function getWorkspaceGitInfo(workspacePath: string): Promise<WorkspaceGitInfo> {
  return review.getWorkspaceGitInfo(workspacePath);
}

export function getChangedFiles(workspacePath: string): Promise<ChangedFileEntry[]> {
  return review.getChangedFiles(workspacePath);
}

export function getFileDiff(workspacePath: string, filePath: string): Promise<string> {
  return review.getFileDiff(workspacePath, filePath);
}

export function stageFile(workspacePath: string, filePath: string): Promise<void> {
  return review.stageFile(workspacePath, filePath);
}

export function undoEdits(workspacePath: string, ops: readonly UndoEditOp[]): Promise<UndoEditsResult> {
  return review.undoEdits(workspacePath, ops);
}

export function redoEdits(workspacePath: string, ops: readonly UndoEditOp[]): Promise<UndoEditsResult> {
  return review.redoEdits(workspacePath, ops);
}
