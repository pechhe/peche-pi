import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutomationScheduler } from "./automation-scheduler.ts";
import { AutomationStore } from "./automation-store.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fake session driver that counts createSession calls and is deliberately slow. */
function makeFakeDriver() {
  let createCount = 0;
  let nextId = 0;
  const driver = {
    async createSession() {
      createCount += 1;
      await delay(30); // slow: window must be claimed BEFORE this resolves
      return { ref: { sessionId: `session-${nextId++}` } };
    },
    async sendUserMessage() {
      await delay(5);
    },
  };
  return { driver, getCreateCount: () => createCount };
}

async function makeDueScheduler() {
  const dir = await mkdtemp(join(tmpdir(), "automation-test-"));
  const store = new AutomationStore(dir);
  await store.load();
  const automation = await store.create({
    name: "Hourly job",
    prompt: "do the thing",
    schedule: { kind: "preset", preset: "hourly" },
    workspaceId: "ws-1",
  });
  // Force "due": baseline lastRunAt is creation time, push it into the past.
  await store.update(automation.id, { lastRunAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() });

  const { driver, getCreateCount } = makeFakeDriver();
  const scheduler = new AutomationScheduler({
    store,
    // deno-lint-ignore no-explicit-any -- minimal fake of the SessionDriver surface used here
    sessionDriver: driver as any,
    getWorkspaceRef: (workspaceId) => ({ workspaceId, path: "/tmp/ws", displayName: "WS" }),
    onAutomationFired: () => {},
    onStateChanged: () => {},
  });
  return { scheduler, store, getCreateCount, automationId: automation.id };
}

test("overlapping check passes fire a due automation only once (re-entrancy guard)", async () => {
  const { scheduler, getCreateCount } = await makeDueScheduler();
  // Two overlapping passes — second starts while first is mid-createSession.
  await Promise.all([scheduler.checkNow(), scheduler.checkNow()]);
  assert.equal(getCreateCount(), 1, "expected exactly one session created across overlapping passes");
});

test("a second pass after a completed pass does not re-fire the same window", async () => {
  const { scheduler, getCreateCount } = await makeDueScheduler();
  await scheduler.checkNow();
  await scheduler.checkNow();
  assert.equal(getCreateCount(), 1, "window already claimed via markRan; must not re-fire");
});
