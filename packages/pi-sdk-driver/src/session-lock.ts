import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

/**
 * Driver-role lock for an append-only pi session file.
 *
 * pi sessions are append-only JSONL trees with no built-in concurrency guard.
 * Two live runtimes appending to the same file (e.g. the `pi` CLI and the
 * desktop GUI) corrupt the tree. This sidecar lock guards the *driver role*:
 * only one process may append at a time. Reading/tailing the file is always
 * safe and never blocked by this lock.
 *
 * The lock is advisory and cooperative across pi runtimes that opt in. It does
 * NOT preempt a foreign process that ignores it — take-over only succeeds once
 * the holder releases, dies, or its heartbeat goes stale.
 */

export type LockKind = "gui" | "cli";

export interface LockInfo {
  readonly pid: number;
  readonly kind: LockKind;
  readonly host: string;
  readonly token: string;
  readonly acquiredAt: string;
  readonly heartbeat: string;
}

export type LockState =
  | { readonly status: "free" }
  | { readonly status: "foreign"; readonly info: LockInfo; readonly alive: boolean };

export interface SessionLockOptions {
  readonly kind: LockKind;
  /** Heartbeat older than this is treated as stale and reclaimable. */
  readonly ttlMs?: number;
  /** Injectable clock for tests. */
  readonly now?: () => number;
  /** Injectable liveness probe for tests. */
  readonly isPidAlive?: (pid: number) => boolean;
}

const DEFAULT_TTL_MS = 30_000;

export class LockHeldError extends Error {
  constructor(
    public readonly sessionFile: string,
    public readonly owner: LockInfo,
    public readonly alive: boolean,
  ) {
    super(
      `Session ${sessionFile} is driven by ${owner.kind} pid ${owner.pid}` +
        (owner.host ? ` on ${owner.host}` : "") +
        (alive ? "" : " (stale)"),
    );
    this.name = "LockHeldError";
  }
}

export function lockPathFor(sessionFile: string): string {
  return `${sessionFile}.lock`;
}

function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = no such process (dead). EPERM = alive but not ours.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLockInfo(path: string): LockInfo | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LockInfo>;
    if (
      typeof parsed.pid === "number" &&
      (parsed.kind === "gui" || parsed.kind === "cli") &&
      typeof parsed.token === "string" &&
      typeof parsed.heartbeat === "string"
    ) {
      return {
        pid: parsed.pid,
        kind: parsed.kind,
        host: typeof parsed.host === "string" ? parsed.host : "",
        token: parsed.token,
        acquiredAt: typeof parsed.acquiredAt === "string" ? parsed.acquiredAt : parsed.heartbeat,
        heartbeat: parsed.heartbeat,
      };
    }
  } catch {
    // Corrupt lock content is treated as a reclaimable foreign lock below.
  }
  // Unparseable but present: surface as a dead foreign lock so it can be reclaimed.
  return { pid: 0, kind: "cli", host: "", token: "", acquiredAt: "", heartbeat: "" };
}

/**
 * Classify the current lock state without acquiring. Never throws on a held
 * lock — callers decide whether to observe-only or attempt a claim.
 */
export function inspectLock(sessionFile: string, options: SessionLockOptions): LockState {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
  const localHost = hostname();

  const info = readLockInfo(lockPathFor(sessionFile));
  if (!info) {
    return { status: "free" };
  }

  const heartbeatMs = Date.parse(info.heartbeat);
  const fresh = Number.isFinite(heartbeatMs) && now() - heartbeatMs < ttlMs;
  // Only probe pid liveness for locks held on this host; a fresh heartbeat from
  // another host is trusted as alive, a stale one is reclaimable.
  const sameHost = info.host === localHost;
  const alive = fresh && (sameHost ? isPidAlive(info.pid) : true);
  return { status: "foreign", info, alive };
}

/**
 * Acquire the driver-role lock. Reclaims a stale or dead lock. Throws
 * {@link LockHeldError} if a live foreign holder owns it.
 */
export class SessionLock {
  private readonly path: string;
  private readonly token = randomUUID();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly isPidAlive: (pid: number) => boolean;
  private held = false;

  constructor(
    private readonly sessionFile: string,
    private readonly options: SessionLockOptions,
  ) {
    this.path = lockPathFor(sessionFile);
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
    this.isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
  }

  get info(): LockInfo {
    return this.buildInfo();
  }

  /** True if this instance currently owns the on-disk lock (token still matches). */
  holdsLock(): boolean {
    if (!this.held) {
      return false;
    }
    const current = readLockInfo(this.path);
    return Boolean(current && current.token === this.token);
  }

  /** Acquire or reclaim. Throws LockHeldError when a live foreign holder owns it. */
  acquire(): void {
    const state = inspectLock(this.sessionFile, {
      ...this.options,
      ttlMs: this.ttlMs,
      now: this.now,
      isPidAlive: this.isPidAlive,
    });
    if (state.status === "foreign" && state.alive) {
      throw new LockHeldError(this.sessionFile, state.info, true);
    }
    // free or reclaimable: overwrite. (Reclaim is intentionally last-writer-wins;
    // a stale/dead holder no longer appends, so clobbering its lock is safe.)
    this.writeLock();
    this.held = true;
  }

  /** Update the heartbeat. No-op if not held. Returns false if the lock was lost. */
  refresh(): boolean {
    if (!this.held) {
      return false;
    }
    const current = readLockInfo(this.path);
    if (!current || current.token !== this.token) {
      // Someone reclaimed our lock (we let the heartbeat lapse).
      this.held = false;
      return false;
    }
    this.writeLock();
    return true;
  }

  /** Release only if we still own it. Safe to call when not held. */
  release(): void {
    if (!this.held) {
      return;
    }
    this.held = false;
    const current = readLockInfo(this.path);
    if (current && current.token === this.token) {
      try {
        unlinkSync(this.path);
      } catch {
        // Best effort: another process may have already reclaimed it.
      }
    }
  }

  private buildInfo(): LockInfo {
    const ts = new Date(this.now()).toISOString();
    return {
      pid: process.pid,
      kind: this.options.kind,
      host: hostname(),
      token: this.token,
      acquiredAt: ts,
      heartbeat: ts,
    };
  }

  private writeLock(): void {
    writeFileSync(this.path, `${JSON.stringify(this.buildInfo())}\n`, "utf8");
  }
}
