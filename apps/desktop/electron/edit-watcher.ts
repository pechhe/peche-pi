import * as fs from "node:fs";
import * as path from "node:path";

export interface LiveEditStats {
  readonly callId: string;
  readonly filePath: string;
  readonly added: number;
  readonly removed: number;
}

export type LiveEditStatsListener = (stats: LiveEditStats) => void;

/**
 * Watches files being edited by the agent and emits live diff stats.
 *
 * When a write/edit tool starts, call `start()` with the file path. The
 * watcher snapshots the pre-edit content and monitors changes via fs.watch.
 * On each change it computes a line diff and emits `{added, removed}` counts
 * to the listener. When the tool finishes, call `stop()`.
 *
 * Performance: only one file is watched per callId. fs.watch + a simple line
 * diff on a single file is negligible compared to LLM inference time.
 */
export class EditWatcher {
  private readonly active = new Map<string, { watcher: fs.FSWatcher; snapshot: string; filePath: string; debounce: ReturnType<typeof setTimeout> }>();
  private listener: LiveEditStatsListener | null = null;

  setListener(listener: LiveEditStatsListener | null): void {
    this.listener = listener;
  }

  /**
   * Start watching a file for live edit stats.
   * @param callId Tool call ID
   * @param filePath Absolute or workspace-relative path to the file being edited
   * @param workspaceRoot Absolute path to the workspace root
   */
  start(callId: string, filePath: string, workspaceRoot: string): void {
    this.stop(callId);

    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(workspaceRoot, filePath);

    // Snapshot the pre-edit content. If the file doesn't exist yet (new file),
    // snapshot as empty.
    let snapshot = "";
    try {
      snapshot = fs.readFileSync(absolutePath, "utf-8");
    } catch {
      // File may not exist yet (write tool creating a new file)
    }

    // Watch the directory for changes — more reliable than watching the file
    // directly (atomic writes, temp files, etc.)
    const dir = path.dirname(absolutePath);
    const basename = path.basename(absolutePath);

    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(dir, (eventType, filename) => {
        if (filename !== basename) return;
        this.handleChange(callId, absolutePath, snapshot);
      });
    } catch {
      // If we can't watch (e.g. directory doesn't exist), bail silently
      return;
    }

    const entry = { watcher, snapshot, filePath: absolutePath, debounce: setTimeout(() => {}, 0) };
    clearTimeout(entry.debounce);
    this.active.set(callId, entry);

    // Emit initial stats (0/0 for existing file, 0/0 for new file)
    this.emit({ callId, filePath, added: 0, removed: 0 });
  }

  /** Stop watching a file. Called when the tool finishes. */
  stop(callId: string): void {
    const entry = this.active.get(callId);
    if (!entry) return;
    entry.watcher.close();
    clearTimeout(entry.debounce);
    this.active.delete(callId);
  }

  /** Stop all watchers. Called on cleanup. */
  stopAll(): void {
    for (const callId of this.active.keys()) {
      this.stop(callId);
    }
  }

  private handleChange(callId: string, absolutePath: string, snapshot: string): void {
    const entry = this.active.get(callId);
    if (!entry) return;

    // Debounce: fs.watch fires multiple events for a single save
    clearTimeout(entry.debounce);
    entry.debounce = setTimeout(() => {
      this.computeAndEmit(callId, absolutePath, snapshot);
    }, 150);
  }

  private computeAndEmit(callId: string, absolutePath: string, snapshot: string): void {
    let current: string;
    try {
      current = fs.readFileSync(absolutePath, "utf-8");
    } catch {
      return;
    }

    const stats = computeLineDiff(snapshot, current);
    this.emit({ callId, filePath: absolutePath, ...stats });
  }

  private emit(stats: LiveEditStats): void {
    this.listener?.(stats);
  }
}

/**
 * Simple line-based diff: counts lines added and removed between two strings.
 * Not a full LCS diff — just counts lines present in `after` but not `before`
 * (added) and vice versa (removed). Fast and good enough for live ticking.
 */
function computeLineDiff(before: string, after: string): { added: number; removed: number } {
  if (before === after) return { added: 0, removed: 0 };

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  const beforeCounts = new Map<string, number>();
  for (const line of beforeLines) {
    beforeCounts.set(line, (beforeCounts.get(line) ?? 0) + 1);
  }

  const afterCounts = new Map<string, number>();
  for (const line of afterLines) {
    afterCounts.set(line, (afterCounts.get(line) ?? 0) + 1);
  }

  let added = 0;
  for (const [line, count] of afterCounts) {
    const beforeCount = beforeCounts.get(line) ?? 0;
    if (count > beforeCount) {
      added += count - beforeCount;
    }
  }

  let removed = 0;
  for (const [line, count] of beforeCounts) {
    const afterCount = afterCounts.get(line) ?? 0;
    if (count > afterCount) {
      removed += count - afterCount;
    }
  }

  return { added, removed };
}
