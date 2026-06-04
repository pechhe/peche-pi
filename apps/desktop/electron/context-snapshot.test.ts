import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Minimal vitest-compatible shim so these tests run under `node --test`
// (the repo's unit test runner) without pulling in vitest.
function expect(actual: unknown) {
  return {
    toBe: (expected: unknown) => assert.strictEqual(actual, expected),
    toEqual: (expected: unknown) => assert.deepStrictEqual(actual, expected),
    toBeDefined: () => assert.notStrictEqual(actual, undefined),
    toBeUndefined: () => assert.strictEqual(actual, undefined),
    toBeNull: () => assert.strictEqual(actual, null),
    toContain: (expected: unknown) => {
      if (typeof actual === "string") {
        assert.ok(actual.includes(String(expected)));
      } else if (Array.isArray(actual)) {
        assert.ok(actual.includes(expected));
      } else {
        assert.fail("toContain expects a string or array");
      }
    },
    toBeGreaterThanOrEqual: (expected: number) =>
      assert.ok(typeof actual === "number" && actual >= expected),
  };
}
import { buildContextSnapshot } from "./context-snapshot.ts";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";

function makeRuntime(overrides?: Partial<RuntimeSnapshot>): RuntimeSnapshot {
  return {
    workspace: { workspaceId: "ws-1", path: "/tmp/test" },
    providers: [],
    models: [],
    skills: [],
    extensions: [],
    settings: {
      enableSkillCommands: true,
      enabledModelPatterns: [],
    },
    ...overrides,
  };
}

describe("buildContextSnapshot", () => {
  it("returns basic sections with no runtime", () => {
    const snapshot = buildContextSnapshot({
      workspaceId: "ws-1",
      workspacePath: "/tmp/test",
    });

    expect(snapshot.workspaceId).toBe("ws-1");
    expect(snapshot.sessionId).toBeUndefined();
    expect(snapshot.sections.length).toBeGreaterThanOrEqual(2);

    const systemPrompt = snapshot.sections.find((s) => s.kind === "system-prompt");
    expect(systemPrompt).toBeDefined();
    expect(systemPrompt!.label).toBe("System prompt");

    const userMessage = snapshot.sections.find((s) => s.kind === "user-message");
    expect(userMessage).toBeDefined();
    expect(userMessage!.content).toBe("{{USER_MESSAGE}}");
  });

  it("includes AGENTS.md when provided", () => {
    const snapshot = buildContextSnapshot({
      workspaceId: "ws-1",
      workspacePath: "/tmp/test",
      agentsMd: "# AGENTS\nBe helpful.",
    });

    const agentsSection = snapshot.sections.find(
      (s) => s.kind === "context-file" && s.label === "AGENTS.md",
    );
    expect(agentsSection).toBeDefined();
    expect(agentsSection!.content).toBe("# AGENTS\nBe helpful.");
    expect(agentsSection!.path).toContain("AGENTS.md");
  });

  it("includes CLAUDE.md when provided", () => {
    const snapshot = buildContextSnapshot({
      workspaceId: "ws-1",
      workspacePath: "/tmp/test",
      claudeMd: "# CLAUDE\nRules here.",
    });

    const claudeSection = snapshot.sections.find(
      (s) => s.kind === "context-file" && s.label === "CLAUDE.md",
    );
    expect(claudeSection).toBeDefined();
    expect(claudeSection!.content).toBe("# CLAUDE\nRules here.");
  });

  it("includes skills from runtime", () => {
    const runtime = makeRuntime({
      skills: [
        {
          name: "test-skill",
          description: "A test skill",
          filePath: "/tmp/test/.agents/skills/test/SKILL.md",
          baseDir: "/tmp/test/.agents/skills/test",
          source: "project",
          enabled: true,
          disableModelInvocation: false,
          slashCommand: "/skill:test-skill",
        },
      ],
    });

    const snapshot = buildContextSnapshot({
      workspaceId: "ws-1",
      workspacePath: "/tmp/test",
      runtime,
    });

    const skillSection = snapshot.sections.find(
      (s) => s.kind === "skill" && s.label === "test-skill",
    );
    expect(skillSection).toBeDefined();
    expect(skillSection!.enabled).toBe(true);
    expect(skillSection!.origin).toBe("project");
    expect(skillSection!.detail).toBe("A test skill");
  });

  it("includes extensions from runtime", () => {
    const runtime = makeRuntime({
      extensions: [
        {
          path: "/tmp/ext/index.ts",
          displayName: "my-extension",
          enabled: true,
          sourceInfo: {
            path: "/tmp/ext/index.ts",
            source: "project",
            scope: "project",
            origin: "top-level",
          },
          commands: ["cmd1"],
          tools: ["tool1", "tool2"],
          flags: [],
          shortcuts: [],
          diagnostics: [],
        },
      ],
    });

    const snapshot = buildContextSnapshot({
      workspaceId: "ws-1",
      workspacePath: "/tmp/test",
      runtime,
    });

    const extSection = snapshot.sections.find(
      (s) => s.kind === "extension" && s.label === "my-extension",
    );
    expect(extSection).toBeDefined();
    expect(extSection!.detail).toBe("Tools: tool1, tool2");
  });

  it("includes model settings from runtime", () => {
    const runtime = makeRuntime({
      settings: {
        defaultProvider: "openai",
        defaultModelId: "gpt-4o",
        defaultThinkingLevel: "medium",
        enableSkillCommands: true,
        enabledModelPatterns: ["openai/gpt-4o"],
      },
    });

    const snapshot = buildContextSnapshot({
      workspaceId: "ws-1",
      workspacePath: "/tmp/test",
      runtime,
    });

    const settingsSection = snapshot.sections.find(
      (s) => s.kind === "model-settings" && s.label === "Runtime settings",
    );
    expect(settingsSection).toBeDefined();
    expect(settingsSection!.content).toContain("Provider: openai");
    expect(settingsSection!.content).toContain("Model: gpt-4o");
    expect(settingsSection!.content).toContain("Thinking: medium");
  });

  it("includes session overrides when sessionId provided", () => {
    const snapshot = buildContextSnapshot({
      workspaceId: "ws-1",
      workspacePath: "/tmp/test",
      sessionId: "sess-1",
      sessionProvider: "anthropic",
      sessionModelId: "claude-3",
      sessionThinkingLevel: "high",
    });

    const overrideSection = snapshot.sections.find(
      (s) => s.kind === "model-settings" && s.label === "Session overrides",
    );
    expect(overrideSection).toBeDefined();
    expect(overrideSection!.content).toContain("Provider: anthropic");
    expect(overrideSection!.content).toContain("Model: claude-3");
    expect(overrideSection!.content).toContain("Thinking: high");
    expect(snapshot.sessionId).toBe("sess-1");
  });

  it("includes session commands", () => {
    const snapshot = buildContextSnapshot({
      workspaceId: "ws-1",
      workspacePath: "/tmp/test",
      sessionCommands: [
        { name: "test-cmd", source: "extension" },
        { name: "prompt-cmd", source: "prompt" },
      ],
    });

    const cmdSections = snapshot.sections.filter((s) => s.kind === "command");
    expect(cmdSections.length).toBe(2);
    expect(cmdSections[0]!.label).toBe("/test-cmd");
    expect(cmdSections[0]!.origin).toBe("extension");
    expect(cmdSections[1]!.label).toBe("/prompt-cmd");
    expect(cmdSections[1]!.origin).toBe("prompt");
  });
});
