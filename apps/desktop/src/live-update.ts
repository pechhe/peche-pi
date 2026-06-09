import type {
  DesktopAppState,
  SelectedTranscriptRecord,
  SessionExtensionUiStateRecord,
  SessionRecord,
  TranscriptMessage,
  WorkspaceRecord,
} from "./desktop-state";

export interface TranscriptDelta {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly initial: boolean;
  readonly messages: readonly TranscriptMessage[];
}

export type DesktopLiveUpdate =
  | { readonly type: "snapshot"; readonly state: DesktopAppState }
  | { readonly type: "navigation"; readonly state: DesktopAppState }
  | { readonly type: "workspace-session"; readonly workspaceId: string; readonly session: SessionRecord | null }
  | {
      readonly type: "selected-session-metadata";
      readonly workspaceId: string;
      readonly sessionId: string;
      readonly extensionUi?: SessionExtensionUiStateRecord;
      readonly queuedComposerMessages?: DesktopAppState["queuedComposerMessages"];
      readonly composerAttachments?: DesktopAppState["composerAttachments"];
    }
  | { readonly type: "selected-transcript"; readonly payload: SelectedTranscriptRecord | null };

export function shouldFlushLiveUpdateImmediately(update: DesktopLiveUpdate): boolean {
  return update.type === "snapshot" || update.type === "navigation" || update.type === "selected-transcript";
}

export function applyDesktopLiveUpdate(state: DesktopAppState | null, update: DesktopLiveUpdate): DesktopAppState | null {
  if (update.type === "snapshot" || update.type === "navigation") {
    return update.state;
  }
  if (!state) {
    return state;
  }
  switch (update.type) {
    case "workspace-session":
      return applyWorkspaceSessionPatch(state, update.workspaceId, update.session);
    case "selected-session-metadata":
      return applySelectedSessionMetadataPatch(state, update);
    case "selected-transcript":
      return state;
  }
}

export function applySelectedTranscriptLiveUpdate(
  current: SelectedTranscriptRecord | null,
  update: DesktopLiveUpdate,
): SelectedTranscriptRecord | null {
  return update.type === "selected-transcript" ? update.payload : current;
}

export function applyTranscriptDelta(
  current: readonly TranscriptMessage[],
  delta: TranscriptDelta,
): readonly TranscriptMessage[] {
  if (delta.initial || current.length === 0) {
    return delta.messages;
  }
  // Merge: replace any existing messages by id, append new ones.
  const byId = new Map<string, TranscriptMessage>();
  for (const msg of current) {
    byId.set(msg.id, msg);
  }
  for (const msg of delta.messages) {
    byId.set(msg.id, msg);
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

function applyWorkspaceSessionPatch(
  state: DesktopAppState,
  workspaceId: string,
  nextSession: SessionRecord | null,
): DesktopAppState {
  const workspaceIndex = state.workspaces.findIndex((workspace) => workspace.id === workspaceId);
  if (workspaceIndex === -1) {
    return state;
  }
  const workspace = state.workspaces[workspaceIndex]!;
  const nextSessions = patchSessionArray(workspace.sessions, nextSession);
  if (nextSessions === workspace.sessions) {
    return state;
  }
  const nextWorkspace: WorkspaceRecord = { ...workspace, sessions: nextSessions };
  const nextWorkspaces = state.workspaces.slice();
  nextWorkspaces[workspaceIndex] = nextWorkspace;
  return { ...state, workspaces: nextWorkspaces };
}

function patchSessionArray(
  sessions: readonly SessionRecord[],
  nextSession: SessionRecord | null,
): readonly SessionRecord[] {
  if (!nextSession) {
    return sessions;
  }
  const index = sessions.findIndex((session) => session.id === nextSession.id);
  if (index === -1) {
    return [nextSession, ...sessions];
  }
  if (sessions[index] === nextSession || shallowSessionEqual(sessions[index]!, nextSession)) {
    return sessions;
  }
  const nextSessions = sessions.slice();
  nextSessions[index] = nextSession;
  return nextSessions;
}

function applySelectedSessionMetadataPatch(
  state: DesktopAppState,
  update: Extract<DesktopLiveUpdate, { type: "selected-session-metadata" }>,
): DesktopAppState {
  if (state.selectedWorkspaceId !== update.workspaceId || state.selectedSessionId !== update.sessionId) {
    return state;
  }
  let changed = false;
  let nextState = state;
  if (update.extensionUi !== undefined) {
    const current = state.sessionExtensionUiBySession[update.sessionId];
    if (current !== update.extensionUi) {
      nextState = {
        ...nextState,
        sessionExtensionUiBySession: {
          ...nextState.sessionExtensionUiBySession,
          [update.sessionId]: update.extensionUi,
        },
      };
      changed = true;
    }
  }
  if (update.queuedComposerMessages !== undefined && update.queuedComposerMessages !== state.queuedComposerMessages) {
    nextState = { ...nextState, queuedComposerMessages: update.queuedComposerMessages };
    changed = true;
  }
  if (update.composerAttachments !== undefined && update.composerAttachments !== state.composerAttachments) {
    nextState = { ...nextState, composerAttachments: update.composerAttachments };
    changed = true;
  }
  return changed ? nextState : state;
}

function shallowSessionEqual(left: SessionRecord, right: SessionRecord): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.updatedAt === right.updatedAt &&
    left.lastViewedAt === right.lastViewedAt &&
    left.archivedAt === right.archivedAt &&
    left.preview === right.preview &&
    left.status === right.status &&
    left.runningSince === right.runningSince &&
    left.hasUnseenUpdate === right.hasUnseenUpdate &&
    left.isAwaitingAssistantText === right.isAwaitingAssistantText &&
    left.config === right.config &&
    left.contextUsage === right.contextUsage
  );
}
