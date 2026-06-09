import {
  applyHostUiRequestToExtensionUiState,
  isExtensionUiDialogRequest,
  sessionKey,
} from "@pi-gui/pi-sdk-driver";
import type { SessionDriverEvent, SessionRef, SessionSnapshot } from "@pi-gui/session-driver";
import type { DesktopAppState, SelectedTranscriptRecord, SessionRecord, TranscriptMessage } from "../src/desktop-state.ts";
import { applyTimelineEvent, appendAssistantDelta, appendReasoningDelta } from "./app-store-timeline.ts";
import {
  hasUnseenSessionUpdate,
  isAwaitingAssistantText,
  latestSessionActivityAt,
  previewFromTranscript,
} from "./app-store-utils.ts";
import {
  createEmptyExtensionUiState,
  serializeExtensionUiState,
  type SessionStateMap,
} from "./session-state-map.ts";

export interface DesktopSessionStatePatch {
  readonly state: DesktopAppState;
  readonly selectedTranscript: SelectedTranscriptRecord | null;
  readonly shouldPersistTranscript: boolean;
  readonly shouldPersistUiImmediately: boolean;
  readonly shouldSchedulePersistUi: boolean;
}

export class DesktopSessionState {
  private readonly sessionState: SessionStateMap;

  constructor(sessionState: SessionStateMap) {
    this.sessionState = sessionState;
  }

  consumeSessionDriverEvent(
    state: DesktopAppState,
    event: SessionDriverEvent,
    options: { readonly sessionActivelyViewed: boolean },
  ): DesktopSessionStatePatch {
    const key = sessionKey(event.sessionRef);

    switch (event.type) {
      case "assistantDelta":
        appendAssistantDelta(
          this.sessionState.transcriptCache,
          this.sessionState.activeAssistantMessageBySession,
          this.sessionState.activeReasoningMessageBySession,
          event.sessionRef,
          event.text,
        );
        break;
      case "reasoningDelta":
        appendReasoningDelta(
          this.sessionState.transcriptCache,
          this.sessionState.activeAssistantMessageBySession,
          this.sessionState.activeReasoningMessageBySession,
          event.sessionRef,
          event.text,
        );
        break;
      case "hostUiRequest":
        state = this.applyHostUiRequest(state, event);
        break;
      case "sessionClosed":
        this.sessionState.extensionUiBySession.delete(key);
        this.sessionState.sessionCommandsBySession.delete(key);
        this.sessionState.queuedComposerMessagesBySession.delete(key);
        this.sessionState.queuedComposerEditsBySession.delete(key);
        break;
      default:
        break;
    }

    applyTimelineEvent(this.sessionState.transcriptCache, event, {
      runMetricsBySession: this.sessionState.runMetricsBySession,
      runningSinceBySession: this.sessionState.runningSinceBySession,
      activeAssistantMessageBySession: this.sessionState.activeAssistantMessageBySession,
      activeReasoningMessageBySession: this.sessionState.activeReasoningMessageBySession,
    });

    const eventSnapshot = snapshotForEvent(event);
    if (eventSnapshot?.contextUsage) {
      this.sessionState.contextUsageBySession.set(key, eventSnapshot.contextUsage);
    }

    state = applySessionEventState(
      state,
      event,
      this.sessionState.transcriptCache,
      this.sessionState.runningSinceBySession,
      this.sessionState.lastViewedAtBySession,
    );

    if (options.sessionActivelyViewed) {
      state = this.markSessionViewed(state, event.sessionRef);
    }

    state = this.syncDerivedSessionState(state, event.sessionRef);

    return {
      state,
      selectedTranscript: this.isSelectedSession(state, event.sessionRef)
        ? this.buildSelectedTranscriptRecord(event.sessionRef)
        : null,
      // "runRetrying" only adds a transient in-memory retry row; never persist it.
      shouldPersistTranscript: event.type !== "hostUiRequest" && event.type !== "runRetrying",
      shouldPersistUiImmediately: event.type === "runCompleted" || event.type === "runFailed" || event.type === "sessionClosed",
      shouldSchedulePersistUi: event.type !== "hostUiRequest" && event.type !== "runRetrying" && event.type !== "runCompleted" && event.type !== "runFailed" && event.type !== "sessionClosed",
    };
  }

  buildSelectedTranscriptRecord(sessionRef: SessionRef): SelectedTranscriptRecord {
    return {
      workspaceId: sessionRef.workspaceId,
      sessionId: sessionRef.sessionId,
      transcript: this.sessionState.transcriptCache.get(sessionKey(sessionRef)) ?? [],
    };
  }

  private getOrCreateExtensionUiState(sessionRef: SessionRef) {
    const key = sessionKey(sessionRef);
    const existing = this.sessionState.extensionUiBySession.get(key);
    if (existing) {
      return existing;
    }

    const created = createEmptyExtensionUiState();
    this.sessionState.extensionUiBySession.set(key, created);
    return created;
  }

  private applyHostUiRequest(
    state: DesktopAppState,
    event: Extract<SessionDriverEvent, { type: "hostUiRequest" }>,
  ): DesktopAppState {
    const key = sessionKey(event.sessionRef);
    if (event.request.kind === "reset") {
      this.sessionState.extensionUiBySession.delete(key);
      return state;
    }

    const uiState = this.getOrCreateExtensionUiState(event.sessionRef);
    applyHostUiRequestToExtensionUiState(uiState, event.request);

    if (event.request.kind === "editorText") {
      this.sessionState.composerDraftsBySession.set(key, event.request.text);
      if (this.isSelectedSession(state, event.sessionRef)) {
        return {
          ...state,
          composerDraft: event.request.text,
          composerDraftSyncSource: "extension-editor-text",
          composerDraftSyncNonce: state.composerDraftSyncNonce + 1,
        };
      }
      return state;
    }

    if (isExtensionUiDialogRequest(event.request)) {
      uiState.pendingDialogs = [
        ...uiState.pendingDialogs.filter((entry) => entry.requestId !== event.request.requestId),
        event.request,
      ];
    }

    return state;
  }

  private syncDerivedSessionState(state: DesktopAppState, sessionRef: SessionRef): DesktopAppState {
    const key = sessionKey(sessionRef);
    const serializedExtensionUi = this.sessionState.extensionUiBySession.get(key);

    return {
      ...state,
      sessionCommandsBySession: updateRecordValue(
        state.sessionCommandsBySession,
        key,
        this.sessionState.sessionCommandsBySession.get(key),
      ),
      sessionExtensionUiBySession: updateRecordValue(
        state.sessionExtensionUiBySession,
        key,
        serializedExtensionUi ? serializeExtensionUiState(serializedExtensionUi) : undefined,
      ),
      lastViewedAtBySession: updateRecordValue(
        state.lastViewedAtBySession,
        key,
        this.sessionState.lastViewedAtBySession.get(key),
      ),
      queuedComposerMessages: this.sessionState.queuedComposerMessagesBySession.get(sessionKey({
        workspaceId: state.selectedWorkspaceId,
        sessionId: state.selectedSessionId,
      })) ?? [],
      editingQueuedMessageId: this.sessionState.queuedComposerEditsBySession.get(sessionKey({
        workspaceId: state.selectedWorkspaceId,
        sessionId: state.selectedSessionId,
      }))?.messageId,
      lastError: this.sessionState.sessionErrorsBySession.get(sessionKey({
        workspaceId: state.selectedWorkspaceId,
        sessionId: state.selectedSessionId,
      })),
    };
  }

  private markSessionViewed(state: DesktopAppState, sessionRef: SessionRef): DesktopAppState {
    const key = sessionKey(sessionRef);
    const fallbackViewedAt = new Date().toISOString();
    const session = state.workspaces
      .find((workspace) => workspace.id === sessionRef.workspaceId)
      ?.sessions.find((entry) => entry.id === sessionRef.sessionId);
    const activityAt = session
      ? latestSessionActivityAt(session.updatedAt, this.sessionState.transcriptCache.get(key) ?? [])
      : fallbackViewedAt;
    const viewedAt = activityAt > fallbackViewedAt ? activityAt : fallbackViewedAt;
    const current = this.sessionState.lastViewedAtBySession.get(key);
    if (current && current >= viewedAt) {
      return state;
    }

    this.sessionState.lastViewedAtBySession.set(key, viewedAt);
    return {
      ...state,
      workspaces: state.workspaces.map((w) =>
        w.id === sessionRef.workspaceId
          ? {
              ...w,
              sessions: w.sessions.map((s) =>
                s.id === sessionRef.sessionId
                  ? {
                      ...s,
                      lastViewedAt: viewedAt,
                      hasUnseenUpdate: false,
                    }
                  : s,
              ),
            }
          : w,
      ),
      lastViewedAtBySession: { ...state.lastViewedAtBySession, [key]: viewedAt },
    };
  }

  private isSelectedSession(state: DesktopAppState, sessionRef: SessionRef): boolean {
    return state.selectedWorkspaceId === sessionRef.workspaceId && state.selectedSessionId === sessionRef.sessionId;
  }
}

function applySessionEventState(
  state: DesktopAppState,
  event: SessionDriverEvent,
  transcriptCache: Map<string, TranscriptMessage[]>,
  runningSinceBySession: Map<string, string>,
  lastViewedAtBySession: Map<string, string>,
): DesktopAppState {
  const key = sessionKey(event.sessionRef);
  const transcript = transcriptCache.get(key) ?? [];
  const preview = previewFromTranscript(transcript);
  const lastViewedAt = lastViewedAtBySession.get(key);

  return {
    ...state,
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === event.sessionRef.workspaceId
        ? {
            ...workspace,
            sessions: workspace.sessions.map((session) =>
              session.id === event.sessionRef.sessionId
                ? updateSessionRecord(session, {
                    snapshot: snapshotForEvent(event),
                    status: statusForEvent(session.status, event),
                    transcript,
                    preview,
                    runningSince: runningSinceBySession.get(key),
                    lastViewedAt,
                  })
                : session,
            ),
          }
        : workspace,
    ),
    revision: state.revision + 1,
  };
}

export function updateSessionRecord(
  session: SessionRecord,
  options: {
    readonly snapshot?: Partial<
      Pick<SessionSnapshot, "title" | "updatedAt" | "archivedAt" | "snoozedUntil" | "toTestAt" | "toTestNote" | "preview" | "status" | "config" | "contextUsage">
    >;
    readonly status?: SessionRecord["status"];
    readonly transcript: readonly TranscriptMessage[];
    readonly preview: string | undefined;
    readonly runningSince: string | undefined;
    readonly lastViewedAt: string | undefined;
  },
): SessionRecord {
  const updatedAt = options.snapshot?.updatedAt ?? session.updatedAt;
  const nextStatus = options.status ?? options.snapshot?.status ?? session.status;
  return {
    ...session,
    title: options.snapshot?.title ?? session.title,
    updatedAt,
    lastViewedAt: options.lastViewedAt,
    archivedAt: options.snapshot?.archivedAt ?? session.archivedAt,
    snoozedUntil: options.snapshot?.snoozedUntil ?? session.snoozedUntil,
    toTestAt: options.snapshot?.toTestAt ?? session.toTestAt,
    toTestNote: options.snapshot?.toTestNote ?? session.toTestNote,
    preview: options.preview ?? options.snapshot?.preview ?? session.preview,
    status: nextStatus,
    runningSince: options.runningSince,
    hasUnseenUpdate: hasUnseenSessionUpdate(nextStatus, updatedAt, options.lastViewedAt, options.transcript),
    isAwaitingAssistantText: isAwaitingAssistantText(nextStatus, options.transcript),
    config: options.snapshot?.config ?? session.config,
    contextUsage: options.snapshot?.contextUsage ?? session.contextUsage,
  };
}

function updateRecordValue<T>(
  record: Readonly<Record<string, T>>,
  key: string,
  value: T | undefined,
): Readonly<Record<string, T>> {
  if (value === undefined) {
    if (!(key in record)) {
      return record;
    }
    const { [key]: _removed, ...rest } = record;
    return rest;
  }

  if (record[key] === value) {
    return record;
  }
  return { ...record, [key]: value };
}

function snapshotForEvent(event: SessionDriverEvent) {
  switch (event.type) {
    case "sessionOpened":
    case "sessionUpdated":
    case "runCompleted":
      return event.snapshot;
    default:
      return undefined;
  }
}

function statusForEvent(sessionStatus: SessionRecord["status"], event: SessionDriverEvent): SessionRecord["status"] {
  switch (event.type) {
    case "sessionOpened":
    case "sessionUpdated":
    case "runCompleted":
      return event.snapshot.status;
    case "runFailed":
      return "failed";
    case "sessionClosed":
      return "idle";
    default:
      return sessionStatus;
  }
}
