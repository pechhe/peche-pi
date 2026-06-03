import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import path from "node:path";
import {
  LockHeldError,
  SessionLock,
  inspectLock,
  lockPathFor,
  type LockInfo,
} from "../src/session-lock.ts";

function tmpSession(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-lock-"));
  const file = path.join(dir, "session.jsonl");
  writeFileSync(file, "");
  return file;
}

function writeForeignLock(sessionFile: string, info: Partial<LockInfo>): void {
  const full: LockInfo = {
    pid: 999999,
    kind: "cli",
    host: hostname(),
    token: "foreign-token",
    acquiredAt: new Date(0).toISOString(),
    heartbeat: new Date(0).toISOString(),
    ...info,
  };
  writeFileSync(lockPathFor(sessionFile), `${JSON.stringify(full)}\n`);
}

test("inspectLock reports free when no lock file", () => {
  const file = tmpSession();
  assert.deepEqual(inspectLock(file, { kind: "gui" }), { status: "free" });
});

test("acquire writes a lock file and release removes it", () => {
  const file = tmpSession();
  const lock = new SessionLock(file, { kind: "gui" });
  lock.acquire();
  assert.ok(existsSync(lockPathFor(file)));
  const written = JSON.parse(readFileSync(lockPathFor(file), "utf8"));
  assert.equal(written.kind, "gui");
  assert.equal(written.pid, process.pid);
  lock.release();
  assert.ok(!existsSync(lockPathFor(file)));
});

test("acquire throws LockHeldError for a live foreign holder", () => {
  const file = tmpSession();
  const now = Date.now();
  writeForeignLock(file, { heartbeat: new Date(now).toISOString() });
  const lock = new SessionLock(file, { kind: "gui", now: () => now, isPidAlive: () => true });
  assert.throws(() => lock.acquire(), (err) => {
    assert.ok(err instanceof LockHeldError);
    assert.equal(err.owner.kind, "cli");
    assert.equal(err.alive, true);
    return true;
  });
});

test("acquire reclaims a stale (expired heartbeat) foreign lock", () => {
  const file = tmpSession();
  const now = 1_000_000;
  writeForeignLock(file, { heartbeat: new Date(now - 60_000).toISOString() });
  const lock = new SessionLock(file, {
    kind: "gui",
    ttlMs: 30_000,
    now: () => now,
    isPidAlive: () => true,
  });
  lock.acquire(); // should not throw
  const written = JSON.parse(readFileSync(lockPathFor(file), "utf8"));
  assert.equal(written.pid, process.pid);
  assert.equal(written.kind, "gui");
});

test("acquire reclaims a fresh lock whose pid is dead (crash recovery)", () => {
  const file = tmpSession();
  const now = 1_000_000;
  writeForeignLock(file, { heartbeat: new Date(now).toISOString() });
  const lock = new SessionLock(file, {
    kind: "gui",
    ttlMs: 30_000,
    now: () => now,
    isPidAlive: () => false, // process crashed
  });
  lock.acquire(); // should not throw
  const written = JSON.parse(readFileSync(lockPathFor(file), "utf8"));
  assert.equal(written.pid, process.pid);
});

test("foreign lock on another host with fresh heartbeat is treated as alive", () => {
  const file = tmpSession();
  const now = 1_000_000;
  writeForeignLock(file, { host: "other-machine", heartbeat: new Date(now).toISOString() });
  const state = inspectLock(file, { kind: "gui", ttlMs: 30_000, now: () => now });
  assert.equal(state.status, "foreign");
  assert.equal(state.status === "foreign" && state.alive, true);
});

test("refresh updates heartbeat and detects reclaim", () => {
  const file = tmpSession();
  let clock = 1_000_000;
  const lock = new SessionLock(file, { kind: "gui", ttlMs: 30_000, now: () => clock });
  lock.acquire();
  const first = JSON.parse(readFileSync(lockPathFor(file), "utf8")).heartbeat;

  clock += 5_000;
  assert.equal(lock.refresh(), true);
  const second = JSON.parse(readFileSync(lockPathFor(file), "utf8")).heartbeat;
  assert.notEqual(first, second);

  // Someone else reclaims by overwriting the token.
  writeForeignLock(file, { token: "stolen", heartbeat: new Date(clock).toISOString() });
  assert.equal(lock.refresh(), false);
});

test("release does not delete a lock reclaimed by someone else", () => {
  const file = tmpSession();
  const lock = new SessionLock(file, { kind: "gui" });
  lock.acquire();
  writeForeignLock(file, { token: "stolen" });
  lock.release();
  // Foreign lock must survive our release.
  assert.ok(existsSync(lockPathFor(file)));
  assert.equal(JSON.parse(readFileSync(lockPathFor(file), "utf8")).token, "stolen");
});

test("corrupt lock content is reclaimable", () => {
  const file = tmpSession();
  writeFileSync(lockPathFor(file), "}{ not json");
  const lock = new SessionLock(file, { kind: "gui", isPidAlive: () => true });
  lock.acquire(); // should not throw
  assert.equal(JSON.parse(readFileSync(lockPathFor(file), "utf8")).pid, process.pid);
});
