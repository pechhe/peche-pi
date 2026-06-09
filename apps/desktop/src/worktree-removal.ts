export interface WorktreeRemovalPreview {
  readonly uncommittedFiles: number;
  readonly unpushedCommits: number;
}

export function buildRemovalConfirm(
  preview: WorktreeRemovalPreview,
  worktreeName: string,
): { message: string; force: boolean } {
  if (preview.uncommittedFiles === 0 && preview.unpushedCommits === 0) {
    return {
      force: false,
      message: `Remove worktree "${worktreeName}"? It's clean — nothing will be lost.`,
    };
  }
  return {
    force: true,
    message: `Worktree "${worktreeName}" has ${preview.uncommittedFiles} uncommitted file(s) and ${preview.unpushedCommits} unpushed commit(s). Removing permanently deletes them. Remove anyway?`,
  };
}
