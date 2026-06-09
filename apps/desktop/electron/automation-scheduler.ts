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

export interface AutomationSchedulerDeps {
  readonly store: AutomationStore;
  /**
   * Create a background thread for the automation (handles worktree creation,
   * model/thinking, auto-title, and the initial prompt). Returns the session id.
   */
  readonly startAutomationThread: (automation: Automation) => Promise<string | undefined>;
  /** Called after an automation fires and a session is created. */
  readonly onAutomationFired: (automation: Automation, sessionId: string) => void;
  /** Called when state needs to be refreshed in the renderer. */
  readonly onStateChanged: () => void;
}

const CHECK_INTERVAL_MS = 60_000; // 1 minute

export class AutomationScheduler {
  private readonly deps: AutomationSchedulerDeps;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  /** Re-entrancy guard: prevents overlapping check passes from double-firing. */
  private checking = false;

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
    // Guard against overlapping passes (startup catch-up, the 60s interval,
    // checkNow, fireNow). Without this, a pass that starts while a previous
    // pass is still awaiting createSession would re-fire the same automation.
    if (this.checking) return;
    this.checking = true;
    try {
      const dueAutomations = this.deps.store.getDueAutomations();
      for (const automation of dueAutomations) {
        // Claim the window BEFORE the slow createSession/sendUserMessage awaits.
        // getDueAutomations() dedups on lastRunAt, so claiming up front stops a
        // second pass from seeing this automation as still due.
        await this.deps.store.markRan(automation.id);
        await this.fireAutomation(automation);
      }
    } finally {
      this.checking = false;
    }
  }

  private async fireAutomation(automation: Automation): Promise<string | undefined> {
    try {
      const sessionId = await this.deps.startAutomationThread(automation);
      if (!sessionId) return undefined;

      // Update lastRunAt
      await this.deps.store.markRan(automation.id);

      this.deps.onAutomationFired(automation, sessionId);
      this.deps.onStateChanged();

      return sessionId;
    } catch (error) {
      console.error(`[automation-scheduler] Failed to fire automation "${automation.name}":`, error);
      return undefined;
    }
  }
}
