import type { SessionRef } from "@pi-gui/session-driver";
import type { SessionQueuedMessage } from "@pi-gui/session-driver";
import type { QueuedComposerMessage } from "../src/desktop-state.ts";
import type { StateAccess, Infrastructure } from "./app-store-internals.ts";
import type { QueuedComposerEditState } from "./session-state-map.ts";
import { sessionKey } from "@pi-gui/pi-sdk-driver";
import { mergeQueuedComposerMessages } from "./app-store-utils.ts";

/* ── Narrow interface consumed by ComposerManager ────────── */

export interface ComposerManagerDeps {
  readonly store: StateAccess & Infrastructure;
}

/* ── ComposerManager ─────────────────────────────────────── */

/**
 * Owns queued-message management, edit-state tracking, and transcript reload.
 * Constructed with a narrow `StateAccess` interface. The DesktopAppStore
 * delegates ComposerOps calls to this manager where possible; publish methods
 * stay in the store because they need private listener access.
 */
export class ComposerManager {
  private readonly store: StateAccess & Infrastructure;

  constructor(deps: ComposerManagerDeps) {
    this.store = deps.store;
  }

  /* ── Queued message management ────────────────────────── */

  updateQueuedComposerMessages(
    sessionRef: SessionRef,
    queuedMessages: readonly SessionQueuedMessage[] | undefined,
  ): void {
    const key = sessionKey(sessionRef);
    const previous = this.store.sessionState.queuedComposerMessagesBySession.get(key);
    const next = mergeQueuedComposerMessages(previous, queuedMessages);
    if (next.length > 0) {
      this.store.sessionState.queuedComposerMessagesBySession.set(key, next);
    } else {
      this.store.sessionState.queuedComposerMessagesBySession.delete(key);
    }

    // Clear edit state if the edited message was removed
    const editState = this.store.sessionState.queuedComposerEditsBySession.get(key);
    if (editState && !next.some((message) => message.id === editState.messageId)) {
      this.store.sessionState.queuedComposerEditsBySession.delete(key);
    }
  }

  getQueuedComposerMessages(sessionRef: SessionRef): readonly QueuedComposerMessage[] {
    const key = sessionKey(sessionRef);
    return this.store.sessionState.queuedComposerMessagesBySession.get(key) ?? [];
  }

  /* ── Edit state tracking ──────────────────────────────── */

  setQueuedComposerEditState(sessionRef: SessionRef, editState: QueuedComposerEditState | undefined): void {
    const key = sessionKey(sessionRef);
    if (editState) {
      this.store.sessionState.queuedComposerEditsBySession.set(key, editState);
    } else {
      this.store.sessionState.queuedComposerEditsBySession.delete(key);
    }
  }

  getQueuedComposerEditState(sessionRef: SessionRef): QueuedComposerEditState | undefined {
    const key = sessionKey(sessionRef);
    return this.store.sessionState.queuedComposerEditsBySession.get(key);
  }

  /* ── Transcript reload ────────────────────────────────── */

  async reloadTranscriptFromDriver(sessionRef: SessionRef): Promise<void> {
    const key = sessionKey(sessionRef);
    const transcript = await this.store.driver.getTranscript(sessionRef);
    this.store.sessionState.transcriptCache.set(key, [...transcript]);
    this.store.sessionState.loadedTranscriptKeys.add(key);
  }
}
