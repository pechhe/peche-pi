import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeSupervisor } from "../src/runtime-supervisor.ts";
import type { RuntimeModelRecord } from "@pi-gui/session-driver/runtime-types";

function fakeAuthStorage() {
  return {
    getOAuthProviders: () => [],
    list: () => [],
    get: () => undefined,
    hasAuth: () => false,
  } as any;
}

function fakeModelRegistry(models: readonly Record<string, unknown>[]) {
  return {
    refresh: () => {},
    getAll: () => models,
    getAvailable: async () => models,
    getProviderAuthStatus: () => ({ configured: true, source: "stored" }),
  } as any;
}

function makeModel(overrides: Record<string, unknown>) {
  return {
    provider: "openai-codex",
    id: "test-model",
    name: "Test model",
    reasoning: true,
    input: ["text"],
    contextWindow: 128000,
    ...overrides,
  };
}

async function buildModelRecords(models: readonly Record<string, unknown>[]): Promise<readonly RuntimeModelRecord[]> {
  const supervisor = new RuntimeSupervisor({
    authStorage: fakeAuthStorage(),
    modelRegistry: fakeModelRegistry(models),
  });
  return (supervisor as unknown as { buildModelRecords(): Promise<readonly RuntimeModelRecord[]> }).buildModelRecords();
}

test("model records keep omitted thinkingLevelMap levels available", async () => {
  const records = await buildModelRecords([
    makeModel({
      id: "gpt-5.5",
      name: "GPT-5.5",
      thinkingLevelMap: { xhigh: "xhigh", minimal: "low" },
    }),
  ]);

  assert.deepEqual(records[0]?.availableThinkingLevels, ["off", "minimal", "low", "medium", "high", "xhigh"]);
});

test("model records hide thinking levels mapped to null", async () => {
  const records = await buildModelRecords([
    makeModel({
      id: "gpt-5.5-pro",
      name: "GPT-5.5 Pro",
      thinkingLevelMap: { off: null, xhigh: "xhigh", minimal: null, low: null },
    }),
  ]);

  assert.deepEqual(records[0]?.availableThinkingLevels, ["medium", "high", "xhigh"]);
});

test("model records expose provider-specific thinking level labels", async () => {
  const [gpt55, opus, plain] = await buildModelRecords([
    makeModel({ provider: "openai", id: "gpt-5.5", thinkingLevelMap: { off: "none", xhigh: "xhigh" } }),
    makeModel({ provider: "amazon-bedrock", id: "claude-opus-4-6", thinkingLevelMap: { xhigh: "max" } }),
    makeModel({ provider: "openai", id: "plain" }),
  ]);

  // openai sorts before amazon-bedrock? records are sorted by providerId, so
  // amazon-bedrock comes first. Resolve by id instead of position.
  const byId = (id: string) => [gpt55, opus, plain].find((r) => r?.modelId === id);
  assert.equal(byId("gpt-5.5")?.thinkingLevelLabels.xhigh, "xhigh");
  assert.equal(byId("claude-opus-4-6")?.thinkingLevelLabels.xhigh, "max");
  assert.deepEqual(byId("plain")?.thinkingLevelLabels, {});
});

test("model records keep xhigh hidden unless explicitly mapped", async () => {
  const records = await buildModelRecords([
    makeModel({ thinkingLevelMap: { minimal: "low" } }),
  ]);

  assert.deepEqual(records[0]?.availableThinkingLevels, ["off", "minimal", "low", "medium", "high"]);
});

test("non-reasoning model records expose only off", async () => {
  const records = await buildModelRecords([
    makeModel({ reasoning: false, thinkingLevelMap: { xhigh: "xhigh" } }),
  ]);

  assert.deepEqual(records[0]?.availableThinkingLevels, ["off"]);
});
