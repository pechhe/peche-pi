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

/** Fake thread-starter that counts fires and is deliberately slow. */
function makeFakeStarter() {
  let createCount = 0;
  let nextId = 0;
  const startAutomationThread = async () => {
    createCount += 1;
    await delay(30); // slow: window must be claimed BEFORE this resolves
    return `session-${nextId++}`;
  };
  return { startAutomationThread, getCreateCount: () => createCount };
}

async function makeDueScheduler() {
  const dir = await mkdtemp(join(tmpdir(), "automation-test-"));
  const store = new AutomationStore(dir);
  await store.load();
  const automation = await store.create({
    name: "Daily job",
    prompt: "do the thing",
    schedule: { frequency: "daily", time: "00:00" },
    workspaceId: "ws-1",
  });
  // Force "due": baseline lastRunAt is creation time, push it 2 days into the
  // past so today's scheduled fire is always after it regardless of clock time.
  await store.update(automation.id, { lastRunAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() });

  const { startAutomationThread, getCreateCount } = makeFakeStarter();
  const scheduler = new AutomationScheduler({
    store,
    startAutomationThread,
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
