import type { ModelSettingsSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { SessionRef } from "@pi-gui/session-driver";
import type {
  ComposerAttachment,
  TranscriptMessage,
} from "../src/desktop-state.ts";
import type { StateAccess, StoreHelpers } from "./app-store-internals.ts";
import {
  writePersistedUiState,
  type PersistedUiState,
} from "./app-store-persistence.ts";
import type { JsonFileStore } from "./json-file-store.ts";
import { serializeCompatibilityByWorkspace } from "./extension-command-compatibility.ts";
import { sessionKey } from "@pi-gui/pi-sdk-driver";
import { cloneComposerAttachments, cloneTranscriptMessage, mapToRecord } from "./app-store-utils.ts";

/* ── Narrow interface consumed by PersistenceManager ─────── */

export interface PersistenceManagerDeps {
  readonly store: StateAccess & StoreHelpers;
  readonly uiStateFilePath: string;
  readonly transcriptStore: JsonFileStore<readonly TranscriptMessage[] | { version: 1; transcript: readonly TranscriptMessage[] }>;
  readonly attachmentStore: JsonFileStore<ComposerAttachment[]>;
}

function hasStoredModelSettings(settings: ModelSettingsSnapshot | undefined): settings is ModelSettingsSnapshot {
  return Boolean(
    settings &&
      (settings.enabledModelPatterns.length > 0 ||
        settings.defaultProvider ||
        settings.defaultModelId ||
        settings.defaultThinkingLevel),
  );
}

/* ── PersistenceManager ──────────────────────────────────── */

/**
 * Owns persistence logic (UI state, composer attachments, transcript cache).
 * Constructed with a narrow `StateAccess & StoreHelpers` interface.
 * The `DesktopAppStore` delegates persistence operations to this manager.
 */
export class PersistenceManager {
  private readonly store: StateAccess & StoreHelpers;
  private readonly uiStateFilePath: string;
  private readonly transcriptStore: JsonFileStore<readonly TranscriptMessage[] | { version: 1; transcript: readonly TranscriptMessage[] }>;
  private readonly attachmentStore: JsonFileStore<ComposerAttachment[]>;
  private persistUiStateTimer: NodeJS.Timeout | undefined;
  private readonly transcriptPersistTimers = new Map<string, NodeJS.Timeout>();

  constructor(deps: PersistenceManagerDeps) {
    this.store = deps.store;
    this.uiStateFilePath = deps.uiStateFilePath;
    this.transcriptStore = deps.transcriptStore;
    this.attachmentStore = deps.attachmentStore;
  }

  /* ── Public API (PersistenceOps) ─────────────────────── */

  async persistUiState(): Promise<void> {
    if (this.persistUiStateTimer) {
      clearTimeout(this.persistUiStateTimer);
      this.persistUiStateTimer = undefined;
    }

    const { state, sessionState, extensionCommandCompatibilityByWorkspace } = this.store;

    const payload: PersistedUiState = {
      selectedWorkspaceId: state.selectedWorkspaceId || undefined,
      selectedSessionId: state.selectedSessionId || undefined,
      activeView: state.activeView,
      composerDraft: state.composerDraft || undefined,
      composerDraftsBySession: mapToRecord(sessionState.composerDraftsBySession),
      extensionCommandCompatibilityByWorkspace: serializeCompatibilityByWorkspace(extensionCommandCompatibilityByWorkspace),
      notificationPreferences: state.notificationPreferences,
      subagentSettings: state.subagentSettings,
      integratedTerminalShell: state.integratedTerminalShell || undefined,
      externalTerminalApp: state.externalTerminalApp || undefined,
      retrySettings: state.retrySettings,
      lastViewedAtBySession: mapToRecord(sessionState.lastViewedAtBySession),
      threadTypeBySession: Object.keys(state.threadTypeBySession).length > 0 ? state.threadTypeBySession : undefined,
      workspaceOrder: state.workspaceOrder.length > 0 ? state.workspaceOrder : undefined,
      modelSettingsScopeMode: state.modelSettingsScopeMode,
      appGlobalModelSettings: hasStoredModelSettings(state.globalModelSettings) ? state.globalModelSettings : undefined,
      modelSelectorPinnedKeys: state.modelSelectorPinnedKeys.length > 0 ? state.modelSelectorPinnedKeys : undefined,
      modelSelectorHiddenKeys: state.modelSelectorHiddenKeys.length > 0 ? state.modelSelectorHiddenKeys : undefined,
      sidebarCollapsed: state.sidebarCollapsed || undefined,
      zoomFactor: state.zoomFactor,
      transcriptVerbose: state.transcriptVerbose,
      composerDeviceMode: state.composerDeviceMode,
      streamReveal: state.streamReveal,
      streamRevealSpeed: state.streamRevealSpeed,
      threadTransition: state.threadTransition,
      themeMode: state.themeMode,
      chats: state.chats.length > 0 ? state.chats : undefined,
      selectedChatId: state.selectedChatId || undefined,
    };

    await writePersistedUiState(this.uiStateFilePath, payload);
  }

  async persistComposerAttachments(
    key: string,
    attachments: readonly ComposerAttachment[],
  ): Promise<void> {
    await this.attachmentStore.write(key, cloneComposerAttachments(attachments));
    await this.persistUiState();
  }

  persistTranscriptCacheForSession(sessionRef: SessionRef): void {
    const key = sessionKey(sessionRef);
    const existing = this.transcriptPersistTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.transcriptPersistTimers.delete(key);
      const transcript = this.store.sessionState.transcriptCache.get(key) ?? [];
      void this.writePersistedTranscript(key, transcript);
    }, 250);

    this.transcriptPersistTimers.set(key, timer);
  }

  schedulePersistUiState(): void {
    if (this.persistUiStateTimer) {
      clearTimeout(this.persistUiStateTimer);
    }

    this.persistUiStateTimer = setTimeout(() => {
      this.persistUiStateTimer = undefined;
      void this.persistUiState();
    }, 250);
  }

  /* ── Transcript I/O (used by DesktopAppStore) ────────── */

  async readPersistedTranscript(
    key: string,
  ): Promise<
    | {
        readonly format: "versioned" | "legacy";
        readonly transcript: TranscriptMessage[];
      }
    | null
  > {
    const persisted = await this.transcriptStore.read(key);
    if (!persisted) {
      return null;
    }

    if (isPersistedTranscriptRecord(persisted)) {
      return {
        format: "versioned",
        transcript: persisted.transcript.map((item) => cloneTranscriptMessage(item as TranscriptMessage)),
      };
    }

    if (Array.isArray(persisted)) {
      return {
        format: "legacy",
        transcript: persisted.map((item) => cloneTranscriptMessage(item as TranscriptMessage)),
      };
    }

    return null;
  }

  async writePersistedTranscript(key: string, transcript: readonly TranscriptMessage[]): Promise<void> {
    await this.transcriptStore.write(key, {
      version: 1,
      transcript: transcript.map(cloneTranscriptMessage),
    });
  }

  /* ── Flush / Cleanup ──────────────────────────────────── */

  /**
   * Flush all pending persistence: clear timers, write pending transcripts,
   * then persist UI state. Used by DesktopAppStore.flushPersistence().
   */
  async flushPersistence(): Promise<void> {
    if (this.persistUiStateTimer) {
      clearTimeout(this.persistUiStateTimer);
      this.persistUiStateTimer = undefined;
    }

    const pendingTranscriptWrites = [...this.transcriptPersistTimers.entries()];
    this.transcriptPersistTimers.clear();
    await Promise.all(
      pendingTranscriptWrites.map(async ([key, timer]) => {
        clearTimeout(timer);
        const transcript = this.store.sessionState.transcriptCache.get(key) ?? [];
        await this.writePersistedTranscript(key, transcript);
      }),
    );

    await this.persistUiState();
  }

  clearTimers(): void {
    if (this.persistUiStateTimer) {
      clearTimeout(this.persistUiStateTimer);
      this.persistUiStateTimer = undefined;
    }
    for (const timer of this.transcriptPersistTimers.values()) {
      clearTimeout(timer);
    }
    this.transcriptPersistTimers.clear();
  }
}

/* ── Helpers ─────────────────────────────────────────────── */

interface PersistedTranscriptRecord {
  readonly version: 1;
  readonly transcript: readonly TranscriptMessage[];
}

type PersistedTranscriptStoreValue = PersistedTranscriptRecord | readonly TranscriptMessage[];

function isPersistedTranscriptRecord(value: PersistedTranscriptStoreValue): value is PersistedTranscriptRecord {
  if (Array.isArray(value)) {
    return false;
  }
  const candidate = value as { version?: unknown; transcript?: unknown };
  return candidate.version === 1 && Array.isArray(candidate.transcript);
}
