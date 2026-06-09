/**
 * Automation persistence store.
 *
 * Stores automations as a single JSON array in
 * `<userData>/automations/automations.json`.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Automation, AutomationSchedule, NewThreadEnvironment } from "../src/desktop-state.ts";
import { scheduleToCron } from "../src/desktop-state.ts";

interface StoredAutomationData {
  readonly automations: readonly Automation[];
}

/**
 * Migrate a persisted automation from older shapes to the current one:
 *  - legacy schedule `{ kind: "preset"|"cron", ... }` → `{ frequency, time, dayOfWeek? }`
 *  - missing `environment` → "local"
 */
function migrateAutomation(raw: Record<string, unknown>): Automation {
  return {
    ...(raw as unknown as Automation),
    schedule: migrateSchedule(raw.schedule),
    environment: ((raw.environment as NewThreadEnvironment) ?? "local"),
  };
}

function migrateSchedule(raw: unknown): AutomationSchedule {
  const s = raw as Record<string, unknown> | undefined;
  // Already in new shape.
  if (s && typeof s.frequency === "string") {
    return {
      frequency: s.frequency as AutomationSchedule["frequency"],
      time: typeof s.time === "string" ? s.time : "09:00",
      ...(typeof s.dayOfWeek === "number" ? { dayOfWeek: s.dayOfWeek } : {}),
    };
  }
  // Legacy preset.
  if (s && s.kind === "preset") {
    switch (s.preset) {
      case "hourly": return { frequency: "hourly", time: "00:00" };
      case "every-evening": return { frequency: "daily", time: "18:00" };
      case "every-morning":
      case "weekdays-morning":
      default: return { frequency: "daily", time: "09:00" };
    }
  }
  // Legacy cron or anything unrecognised → safe default.
  return { frequency: "daily", time: "09:00" };
}

export class AutomationStore {
  private readonly filePath: string;
  private cachedAutomations: Automation[] = [];

  constructor(userDataDir: string) {
    this.filePath = join(userDataDir, "automations", "automations.json");
  }

  async load(): Promise<Automation[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const data = JSON.parse(raw) as { automations: readonly Record<string, unknown>[] };
      this.cachedAutomations = (data.automations ?? []).map(migrateAutomation);
    } catch {
      this.cachedAutomations = [];
    }
    return this.cachedAutomations;
  }

  async save(automations: readonly Automation[]): Promise<void> {
    this.cachedAutomations = [...automations];
    const dir = join(this.filePath, "..");
    await mkdir(dir, { recursive: true });
    await writeFile(
      this.filePath,
      `${JSON.stringify({ automations } satisfies StoredAutomationData, null, 2)}\n`,
      "utf8",
    );
  }

  getAll(): readonly Automation[] {
    return this.cachedAutomations;
  }

  getById(id: string): Automation | undefined {
    return this.cachedAutomations.find((a) => a.id === id);
  }

  async create(input: {
    name?: string;
    prompt: string;
    schedule: AutomationSchedule;
    workspaceId: string;
    environment?: NewThreadEnvironment;
    model?: { provider: string; modelId: string };
    thinkingLevel?: string;
    enabled?: boolean;
  }): Promise<Automation> {
    const now = new Date().toISOString();
    const automation: Automation = {
      id: randomUUID(),
      name: input.name ?? "",
      prompt: input.prompt,
      schedule: input.schedule,
      workspaceId: input.workspaceId,
      environment: input.environment ?? "local",
      model: input.model,
      thinkingLevel: input.thinkingLevel,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      // Baseline lastRunAt at creation so the automation does NOT fire for a
      // scheduled time that already passed before it existed. It fires at the
      // next scheduled time after creation.
      lastRunAt: now,
    };
    this.cachedAutomations = [...this.cachedAutomations, automation];
    await this.save(this.cachedAutomations);
    return automation;
  }

  async update(
    id: string,
    patch: Partial<Omit<Automation, "id" | "createdAt">>,
  ): Promise<Automation | undefined> {
    const index = this.cachedAutomations.findIndex((a) => a.id === id);
    if (index === -1) return undefined;
    const existing = this.cachedAutomations[index]!;
    const updated: Automation = {
      id: existing.id,
      createdAt: existing.createdAt,
      name: patch.name ?? existing.name,
      prompt: patch.prompt ?? existing.prompt,
      schedule: patch.schedule ?? existing.schedule,
      workspaceId: patch.workspaceId ?? existing.workspaceId,
      environment: patch.environment ?? existing.environment,
      model: patch.model ?? existing.model,
      thinkingLevel: patch.thinkingLevel ?? existing.thinkingLevel,
      enabled: patch.enabled ?? existing.enabled,
      lastRunAt: patch.lastRunAt ?? existing.lastRunAt,
      updatedAt: new Date().toISOString(),
    };
    this.cachedAutomations = [
      ...this.cachedAutomations.slice(0, index),
      updated,
      ...this.cachedAutomations.slice(index + 1),
    ];
    await this.save(this.cachedAutomations);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const index = this.cachedAutomations.findIndex((a) => a.id === id);
    if (index === -1) return false;
    this.cachedAutomations = [
      ...this.cachedAutomations.slice(0, index),
      ...this.cachedAutomations.slice(index + 1),
    ];
    await this.save(this.cachedAutomations);
    return true;
  }

  async markRan(id: string): Promise<void> {
    await this.update(id, { lastRunAt: new Date().toISOString() });
  }

  /** Return enabled automations that should fire now (skip-missed logic). */
  getDueAutomations(): Automation[] {
    const now = Date.now();
    return this.cachedAutomations.filter((a) => {
      if (!a.enabled) return false;
      const cronExpression = resolveCron(a.schedule);
      const lastScheduled = computeLastScheduledFire(cronExpression, now);
      if (!lastScheduled) return false;
      // Skip if already ran this window
      if (a.lastRunAt && new Date(a.lastRunAt).getTime() >= lastScheduled) return false;
      return true;
    });
  }
}

// ── Cron helpers (lightweight, no dependency) ──────────

export function resolveCron(schedule: AutomationSchedule): string {
  return scheduleToCron(schedule);
}

/**
 * Compute the most recent fire time (ms) for a cron expression that is ≤ `now`.
 * Returns undefined if the expression can't be parsed.
 *
 * This is a simplified evaluator — checks minute, hour, day-of-month, month,
 * day-of-week. It walks backward from now in 1-minute steps up to 7 days.
 */
export function computeLastScheduledFire(
  cronExpression: string,
  nowMs: number,
): number | undefined {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return undefined;

  const [minField, hourField, domField, monthField, dowField] = parts as [string, string, string, string, string];

  const now = new Date(nowMs);
  // Walk backward in 1-minute steps, max 7 days
  const maxSteps = 7 * 24 * 60;
  const candidate = new Date(now);

  for (let step = 0; step < maxSteps; step++) {
    if (
      matchesCronField(minField, candidate.getMinutes()) &&
      matchesCronField(hourField, candidate.getHours()) &&
      matchesCronField(domField, candidate.getDate()) &&
      matchesCronField(monthField, candidate.getMonth() + 1) &&
      matchesCronField(dowField, candidate.getDay())
    ) {
      return candidate.getTime();
    }
    candidate.setMinutes(candidate.getMinutes() - 1);
    candidate.setSeconds(0, 0);
  }

  return undefined;
}

function matchesCronField(field: string, value: number): boolean {
  if (field === "*") return true;

  // Handle comma-separated values: "1,3,5"
  const parts = field.split(",");
  for (const part of parts) {
    if (matchesCronPart(part, value)) return true;
  }
  return false;
}

function matchesCronPart(part: string, value: number): boolean {
  // Handle step: */5 or 1-10/2
  if (part.includes("/")) {
    const range = part.split("/")[0] ?? "*";
    const stepStr = part.split("/")[1] ?? "1";
    const step = parseInt(stepStr, 10);
    if (step <= 0) return false;
    if (range === "*") return value % step === 0;
    const [lo, hi] = parseRange(range);
    return value >= lo && value <= hi && (value - lo) % step === 0;
  }

  // Handle range: 1-5
  if (part.includes("-")) {
    const [lo, hi] = parseRange(part);
    return value >= lo && value <= hi;
  }

  // Handle wildcard
  if (part === "*") return true;

  // Exact match
  return parseInt(part, 10) === value;
}

function parseRange(range: string): [number, number] {
  const parts = range.split("-");
  const lo = parseInt(parts[0] ?? "0", 10);
  const hi = parseInt(parts[1] ?? "0", 10);
  return [lo, hi];
}
