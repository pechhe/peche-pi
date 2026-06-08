/**
 * Automation scheduler.
 *
 * Runs in the main process. Checks every 60 seconds for due automations
 * and fires them by creating sessions + sending prompts via the session driver.
 *
 * On app startup, performs a catch-up check (skip-missed: runs each missed
 * automation once, not once per missed interval).
 */

import type { Automation } from "../src/desktop-state.ts";
import { AutomationStore } from "./automation-store.ts";
import type { SessionDriver, WorkspaceRef } from "@pi-gui/session-driver/types";

export interface AutomationSchedulerDeps {
  readonly store: AutomationStore;
  readonly sessionDriver: SessionDriver;
  readonly getWorkspaceRef: (workspaceId: string) => WorkspaceRef | undefined;
  /** Called after an automation fires and a session is created. */
  readonly onAutomationFired: (automation: Automation, sessionId: string) => void;
  /** Called when state needs to be refreshed in the renderer. */
  readonly onStateChanged: () => void;
}

const CHECK_INTERVAL_MS = 60_000; // 1 minute

export class AutomationScheduler {
  private readonly deps: AutomationSchedulerDeps;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(deps: AutomationSchedulerDeps) {
    this.deps = deps;
  }

  /** Start the scheduler. Call once on app ready. */
  start(): void {
    // Catch-up check on startup
    void this.checkAndFire();
    this.intervalHandle = setInterval(() => {
      void this.checkAndFire();
    }, CHECK_INTERVAL_MS);
  }

  /** Stop the scheduler (for cleanup). */
  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Manually trigger a check (e.g. after enabling/disabling an automation). */
  async checkNow(): Promise<void> {
    await this.checkAndFire();
  }

  /**
   * Fire a single automation on demand (e.g. from the UI "Run now" button).
   * Creates a session immediately, regardless of schedule.
   */
  async fireNow(automationId: string): Promise<string | undefined> {
    const automation = this.deps.store.getById(automationId);
    if (!automation) return undefined;

    return this.fireAutomation(automation);
  }

  private async checkAndFire(): Promise<void> {
    const dueAutomations = this.deps.store.getDueAutomations();
    for (const automation of dueAutomations) {
      await this.fireAutomation(automation);
    }
  }

  private async fireAutomation(automation: Automation): Promise<string | undefined> {
    const workspaceRef = this.deps.getWorkspaceRef(automation.workspaceId);
    if (!workspaceRef) return undefined;

    try {
      const session = await this.deps.sessionDriver.createSession(workspaceRef, {
        title: `⚡ ${automation.name}`,
        initialModel: automation.model ? { provider: automation.model.provider, modelId: automation.model.modelId } : undefined,
        initialThinkingLevel: automation.thinkingLevel,
      });

      await this.deps.sessionDriver.sendUserMessage(
        { workspaceId: workspaceRef.workspaceId, sessionId: session.ref.sessionId },
        { text: automation.prompt },
      );

      // Update lastRunAt
      await this.deps.store.markRan(automation.id);

      this.deps.onAutomationFired(automation, session.ref.sessionId);
      this.deps.onStateChanged();

      return session.ref.sessionId;
    } catch (error) {
      console.error(`[automation-scheduler] Failed to fire automation "${automation.name}":`, error);
      return undefined;
    }
  }
}
