import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatRecord, DesktopAppState, SessionRecord, WorkspaceRecord } from "../desktop-state";
import type { TranscriptSearchMatch } from "../ipc";

export type GlobalSearchScope = "thread" | "project" | "all";
export type GlobalSearchArchiveFilter = "all" | "active" | "past";

export interface GlobalSearchResult {
  readonly id: string;
  readonly kind: "thread" | "chat";
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly chatId?: string;
  readonly projectName: string;
  readonly title: string;
  readonly preview: string;
  readonly updatedAt: string;
  readonly archived: boolean;
  /** Present when this result was found via transcript content search. */
  readonly transcriptSnippet?: string;
  /** The message ID within the transcript to jump to. */
  readonly transcriptMessageId?: string;
}

interface UseGlobalSearchInput {
  readonly state: DesktopAppState | null;
  readonly selectedWorkspace?: WorkspaceRecord;
  readonly selectedSession?: SessionRecord;
}

interface BuildGlobalSearchResultsInput extends UseGlobalSearchInput {
  readonly query: string;
  readonly scope: GlobalSearchScope;
  readonly archiveFilter: GlobalSearchArchiveFilter;
}

function haystackMatches(query: string, title: string, preview: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return title.toLowerCase().includes(q) || preview.toLowerCase().includes(q);
}

function workspaceInCurrentProject(workspace: WorkspaceRecord, selectedWorkspace?: WorkspaceRecord): boolean {
  if (!selectedWorkspace) return false;
  const selectedRootId = selectedWorkspace.rootWorkspaceId ?? selectedWorkspace.id;
  return workspace.id === selectedRootId || workspace.rootWorkspaceId === selectedRootId || workspace.id === selectedWorkspace.id;
}

function passesArchiveFilter(archived: boolean, filter: GlobalSearchArchiveFilter): boolean {
  if (filter === "active") return !archived;
  if (filter === "past") return archived;
  return true;
}

/** Build the set of session keys that are in scope but did NOT match on title/preview. */
function buildCandidateSessionKeys({
  state,
  selectedWorkspace,
  selectedSession,
  query,
  scope,
  archiveFilter,
}: BuildGlobalSearchResultsInput): { keys: string[]; matchedIds: Set<string> } {
  const trimmed = query.trim();
  if (!state || !trimmed) return { keys: [], matchedIds: new Set() };

  const keys: string[] = [];
  const matchedIds = new Set<string>();

  for (const workspace of state.workspaces) {
    if (scope === "project" && !workspaceInCurrentProject(workspace, selectedWorkspace)) continue;
    for (const session of workspace.sessions) {
      if (scope === "thread" && session.id !== selectedSession?.id) continue;
      const archived = Boolean(session.archivedAt);
      if (!passesArchiveFilter(archived, archiveFilter)) continue;
      if (haystackMatches(trimmed, session.title, session.preview)) {
        matchedIds.add(`thread:${workspace.id}:${session.id}`);
      } else {
        keys.push(`${workspace.id}:${session.id}`);
      }
    }
  }

  return { keys, matchedIds };
}

export function buildGlobalSearchResults({
  state,
  selectedWorkspace,
  selectedSession,
  query,
  scope,
  archiveFilter,
}: BuildGlobalSearchResultsInput): readonly GlobalSearchResult[] {
  const trimmed = query.trim();
  if (!state || !trimmed) return [];

  const items: GlobalSearchResult[] = [];

  for (const workspace of state.workspaces) {
    if (scope === "project" && !workspaceInCurrentProject(workspace, selectedWorkspace)) continue;
    for (const session of workspace.sessions) {
      if (scope === "thread" && session.id !== selectedSession?.id) continue;
      const archived = Boolean(session.archivedAt);
      if (!passesArchiveFilter(archived, archiveFilter)) continue;
      if (!haystackMatches(trimmed, session.title, session.preview)) continue;
      items.push({
        id: `thread:${workspace.id}:${session.id}`,
        kind: "thread",
        workspaceId: workspace.id,
        sessionId: session.id,
        projectName: workspace.name,
        title: session.title,
        preview: session.preview,
        updatedAt: session.updatedAt,
        archived,
      });
    }
  }

  const chatWorkspaceIds = new Set(
    scope === "project" && selectedWorkspace ? [selectedWorkspace.id, selectedWorkspace.rootWorkspaceId].filter(Boolean) : undefined,
  );
  for (const chat of state.chats) {
    if (scope === "thread" && chat.id !== state.selectedChatId) continue;
    if (scope === "project" && chat.chatWorkspaceId && !chatWorkspaceIds.has(chat.chatWorkspaceId)) continue;
    if (scope === "project" && !chat.chatWorkspaceId) continue;
    const archived = Boolean(chat.archivedAt);
    if (!passesArchiveFilter(archived, archiveFilter)) continue;
    if (!haystackMatches(trimmed, chat.title, chat.preview)) continue;
    items.push(chatToResult(chat));
  }

  return items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** Look up session metadata to build a GlobalSearchResult from a transcript match. */
function transcriptMatchToResult(
  state: DesktopAppState,
  match: TranscriptSearchMatch,
): GlobalSearchResult | undefined {
  const [workspaceId, sessionId] = match.sessionKey.split(":");
  if (!workspaceId || !sessionId) return undefined;
  for (const workspace of state.workspaces) {
    if (workspace.id !== workspaceId) continue;
    for (const session of workspace.sessions) {
      if (session.id !== sessionId) continue;
      return {
        id: `thread:${workspaceId}:${sessionId}`,
        kind: "thread",
        workspaceId,
        sessionId,
        projectName: workspace.name,
        title: session.title,
        preview: session.preview,
        updatedAt: session.updatedAt,
        archived: Boolean(session.archivedAt),
        transcriptSnippet: match.snippet,
        transcriptMessageId: match.messageId,
      };
    }
  }
  return undefined;
}

export function useGlobalSearch({ state, selectedWorkspace, selectedSession }: UseGlobalSearchInput) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<GlobalSearchScope>("project");
  const [archiveFilter, setArchiveFilter] = useState<GlobalSearchArchiveFilter>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const [transcriptResults, setTranscriptResults] = useState<readonly GlobalSearchResult[]>([]);

  // Sync title/preview results
  const titleResults = useMemo<readonly GlobalSearchResult[]>(() => buildGlobalSearchResults({
    state,
    selectedWorkspace,
    selectedSession,
    query,
    scope,
    archiveFilter,
  }), [archiveFilter, query, scope, selectedSession, selectedWorkspace, state]);

  // Async transcript search — debounced, runs after sync results are computed
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef(0);

  useEffect(() => {
    setTranscriptResults([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!state || trimmed.length < 3) return; // only search transcripts for 3+ char queries

    const { keys, matchedIds } = buildCandidateSessionKeys({
      state, selectedWorkspace, selectedSession, query: trimmed, scope, archiveFilter,
    });
    if (keys.length === 0) return;

    const searchId = ++abortRef.current;

    debounceRef.current = setTimeout(async () => {
      try {
        const api = window.piApp;
        if (!api) return;
        const matches = await api.searchTranscriptText(keys, trimmed);
        if (searchId !== abortRef.current) return; // stale

        const results: GlobalSearchResult[] = [];
        for (const match of matches) {
          const result = transcriptMatchToResult(state, match);
          if (result && !matchedIds.has(result.id)) {
            results.push(result);
          }
        }
        if (searchId === abortRef.current) {
          setTranscriptResults(results);
        }
      } catch {
        // Transcript search is best-effort; ignore errors
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, scope, archiveFilter, state, selectedWorkspace, selectedSession]);

  // Merge: title matches first, then transcript matches, all sorted by updatedAt
  const results = useMemo<readonly GlobalSearchResult[]>(() => {
    if (transcriptResults.length === 0) return titleResults;
    const merged = [...titleResults, ...transcriptResults];
    return merged.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [titleResults, transcriptResults]);

  return {
    isOpen,
    query,
    scope,
    archiveFilter,
    activeIndex: Math.min(activeIndex, Math.max(0, results.length - 1)),
    results,
    open: () => setIsOpen(true),
    close: () => {
      setIsOpen(false);
      setQuery("");
      setActiveIndex(0);
      setTranscriptResults([]);
    },
    setQuery: (next: string) => {
      setQuery(next);
      setActiveIndex(0);
    },
    setScope: (next: GlobalSearchScope) => {
      setScope(next);
      setActiveIndex(0);
    },
    setArchiveFilter: (next: GlobalSearchArchiveFilter) => {
      setArchiveFilter(next);
      setActiveIndex(0);
    },
    setActiveIndex,
  };
}

function chatToResult(chat: ChatRecord): GlobalSearchResult {
  return {
    id: `chat:${chat.id}`,
    kind: "chat",
    chatId: chat.id,
    projectName: "Chats",
    title: chat.title,
    preview: chat.preview,
    updatedAt: chat.updatedAt,
    archived: Boolean(chat.archivedAt),
  };
}
