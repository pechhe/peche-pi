import { sessionKey } from "@pi-gui/pi-sdk-driver";
import type { SessionDriverEvent, SessionQueuedMessage, SessionRef } from "@pi-gui/session-driver";
import type { TranscriptMessage } from "../src/desktop-state.ts";
import {
  appendAssistantDeltaToTimeline,
  appendQueuedUserMessageToTimeline,
  appendReasoningDeltaToTimeline,
  appendUserMessageToTimeline,
  applySessionEventToTimeline,
  type RunMetrics,
  type SessionTimelineRuntimeState,
  type TimelineItemFactory,
} from "../src/timeline-model.ts";
import {
  makeActivityItem,
  makeReasoningItem,
  makeSummaryItem,
  makeToolItem,
  makeTranscriptMessage,
  makeTranscriptMessageWithAttachments,
} from "./app-store-utils.ts";

export type { RunMetrics } from "../src/timeline-model.ts";

interface TimelineRuntimeState {
  readonly runMetricsBySession: Map<string, RunMetrics>;
  readonly runningSinceBySession: Map<string, string>;
  readonly activeAssistantMessageBySession: Map<string, string>;
  readonly activeReasoningMessageBySession: Map<string, string>;
}

const timelineItemFactory: TimelineItemFactory = {
  message: makeTranscriptMessage,
  messageWithAttachments: makeTranscriptMessageWithAttachments,
  activity: makeActivityItem,
  summary: makeSummaryItem,
  tool: makeToolItem,
  reasoning: makeReasoningItem,
};

export function appendUserMessage(
  transcriptCache: Map<string, TranscriptMessage[]>,
  sessionRef: SessionRef,
  text: string,
  attachments: NonNullable<Extract<TranscriptMessage, { kind: "message" }>["attachments"]> = [],
): TranscriptMessage[] {
  const key = sessionKey(sessionRef);
  const transcript = appendUserMessageToTimeline(transcriptCache.get(key) ?? [], text, attachments, timelineItemFactory);
  transcriptCache.set(key, transcript);
  return transcript;
}

export function appendQueuedUserMessage(
  transcriptCache: Map<string, TranscriptMessage[]>,
  sessionRef: SessionRef,
  message: SessionQueuedMessage,
): void {
  const key = sessionKey(sessionRef);
  transcriptCache.set(key, appendQueuedUserMessageToTimeline(transcriptCache.get(key) ?? [], message));
}

export function appendAssistantDelta(
  transcriptCache: Map<string, TranscriptMessage[]>,
  activeAssistantMessageBySession: Map<string, string>,
  activeReasoningMessageBySession: Map<string, string>,
  sessionRef: SessionRef,
  text: string,
): void {
  const key = sessionKey(sessionRef);
  const runtime: SessionTimelineRuntimeState = {
    activeAssistantMessageId: activeAssistantMessageBySession.get(key),
    activeReasoningMessageId: activeReasoningMessageBySession.get(key),
  };
  const transcript = appendAssistantDeltaToTimeline(transcriptCache.get(key) ?? [], runtime, text, timelineItemFactory);
  syncSessionRuntimeState(key, runtime, {
    runMetricsBySession: new Map(),
    runningSinceBySession: new Map(),
    activeAssistantMessageBySession,
    activeReasoningMessageBySession,
  });
  transcriptCache.set(key, transcript);
}

export function appendReasoningDelta(
  transcriptCache: Map<string, TranscriptMessage[]>,
  activeAssistantMessageBySession: Map<string, string>,
  activeReasoningMessageBySession: Map<string, string>,
  sessionRef: SessionRef,
  text: string,
): void {
  const key = sessionKey(sessionRef);
  const runtime: SessionTimelineRuntimeState = {
    activeAssistantMessageId: activeAssistantMessageBySession.get(key),
    activeReasoningMessageId: activeReasoningMessageBySession.get(key),
  };
  const transcript = appendReasoningDeltaToTimeline(transcriptCache.get(key) ?? [], runtime, text, timelineItemFactory);
  syncSessionRuntimeState(key, runtime, {
    runMetricsBySession: new Map(),
    runningSinceBySession: new Map(),
    activeAssistantMessageBySession,
    activeReasoningMessageBySession,
  });
  transcriptCache.set(key, transcript);
}

export function clearActiveAssistantMessage(
  activeAssistantMessageBySession: Map<string, string>,
  sessionRef: SessionRef,
): void {
  activeAssistantMessageBySession.delete(sessionKey(sessionRef));
}

export function applyTimelineEvent(
  transcriptCache: Map<string, TranscriptMessage[]>,
  event: SessionDriverEvent,
  state: TimelineRuntimeState,
): void {
  const key = sessionKey(event.sessionRef);
  const runtime = readSessionRuntimeState(key, state);
  const transcript = applySessionEventToTimeline(transcriptCache.get(key) ?? [], event, runtime, timelineItemFactory);
  syncSessionRuntimeState(key, runtime, state);
  transcriptCache.set(key, transcript);
}

function readSessionRuntimeState(key: string, state: TimelineRuntimeState): SessionTimelineRuntimeState {
  return {
    runMetrics: state.runMetricsBySession.get(key),
    runningSince: state.runningSinceBySession.get(key),
    activeAssistantMessageId: state.activeAssistantMessageBySession.get(key),
    activeReasoningMessageId: state.activeReasoningMessageBySession.get(key),
  };
}

function syncSessionRuntimeState(key: string, runtime: SessionTimelineRuntimeState, state: TimelineRuntimeState): void {
  if (runtime.runMetrics) {
    state.runMetricsBySession.set(key, runtime.runMetrics);
  } else {
    state.runMetricsBySession.delete(key);
  }

  if (runtime.runningSince) {
    state.runningSinceBySession.set(key, runtime.runningSince);
  } else {
    state.runningSinceBySession.delete(key);
  }

  if (runtime.activeAssistantMessageId) {
    state.activeAssistantMessageBySession.set(key, runtime.activeAssistantMessageId);
  } else {
    state.activeAssistantMessageBySession.delete(key);
  }

  if (runtime.activeReasoningMessageId) {
    state.activeReasoningMessageBySession.set(key, runtime.activeReasoningMessageId);
  } else {
    state.activeReasoningMessageBySession.delete(key);
  }
}
