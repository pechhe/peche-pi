import { describe, expect, it } from "vitest";
import { collectAgents } from "./subagent-timeline";
import type { TranscriptMessage } from "./timeline-types";

function tool(
  callId: string,
  toolName: "subagent" | "subagent_resume",
  input: unknown,
  output?: unknown,
  createdAt = "2026-01-01T00:00:00Z",
): TranscriptMessage {
  return {
    kind: "tool",
    id: callId,
    callId,
    toolName,
    status: "success",
    label: toolName,
    createdAt,
    input,
    output,
  } as unknown as TranscriptMessage;
}

describe("collectAgents", () => {
  it("merges a spawn and a later resume of the same name into one entity", () => {
    const transcript: TranscriptMessage[] = [
      tool("c1", "subagent", { name: "impl-1", agent: "implementer", task: "do it" }),
      tool("c2", "subagent_resume", { name: "impl-1", task: "yes implement" }),
    ];

    const { entities, primaryNamesByCall } = collectAgents(transcript);

    expect(entities.size).toBe(1);
    const entity = entities.get("impl-1")!;
    expect(entity.events).toHaveLength(2);
    expect(entity.events.map((e) => e.verb)).toEqual(["Spawn", "Resume"]);
    expect(entity.agent).toBe("implementer");

    // The spawn owns the card; the resume folds in (introduces no new entity).
    expect(primaryNamesByCall.get("c1")).toEqual(["impl-1"]);
    expect(primaryNamesByCall.get("c2")).toBeUndefined();
  });

  it("treats a fresh re-spawn after a stall as the same entity, not a new card", () => {
    const transcript: TranscriptMessage[] = [
      tool("c1", "subagent", { name: "impl-1", agent: "implementer" }, { details: { status: "started", name: "impl-1" } }),
      tool("c2", "subagent", { name: "impl-1", agent: "implementer" }),
    ];
    const { entities, primaryNamesByCall } = collectAgents(transcript);
    expect(entities.size).toBe(1);
    expect(entities.get("impl-1")!.events).toHaveLength(2);
    expect(primaryNamesByCall.get("c2")).toBeUndefined();
  });

  it("splits a batch launch into one entity per child", () => {
    const transcript: TranscriptMessage[] = [
      tool("c1", "subagent", { children: [{ name: "a", agent: "scout" }, { name: "b", agent: "verifier" }] }),
    ];
    const { entities, primaryNamesByCall } = collectAgents(transcript);
    expect(entities.size).toBe(2);
    expect(primaryNamesByCall.get("c1")).toEqual(["a", "b"]);
  });
});
