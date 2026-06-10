export interface ChassisSubmitEffect {
  readonly type: "submit";
  readonly text: string;
}

export interface ChassisWrapEffect {
  readonly type: "wrap";
  readonly template: string;
}

export interface ChassisReminderEffect {
  readonly type: "reminder";
  readonly text: string;
}

export type ChassisEffect = ChassisSubmitEffect | ChassisWrapEffect | ChassisReminderEffect;

export const WRAP_INPUT_TOKEN = "{{input}}";

export interface ChassisAction {
  readonly id: string;
  readonly label: string;
  readonly showLabel: boolean;
  /** oneShot pairs only with `submit`; sticky pairs only with `wrap`. */
  readonly trigger: "oneShot" | "sticky";
  readonly effect: ChassisEffect;
}

/**
 * Single-active sticky radio: turning the active id off clears activation;
 * turning any other id on replaces the active one (never two at once).
 */
export function toggleStickyActivation(activeId: string | null, id: string): string | null {
  return activeId === id ? null : id;
}

export interface ParsedChassisState {
  readonly actions: ChassisAction[];
  readonly dropped: number;
}

function parseAction(value: unknown): ChassisAction | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id.length === 0) return null;
  if (typeof v.label !== "string") return null;
  const effect = v.effect;
  if (typeof effect !== "object" || effect === null) return null;
  const e = effect as Record<string, unknown>;
  if (v.trigger === "oneShot") {
    if (e.type !== "submit" || typeof e.text !== "string") return null;
    return {
      id: v.id,
      label: v.label,
      showLabel: v.showLabel !== false,
      trigger: "oneShot",
      effect: { type: "submit", text: e.text },
    };
  }
  if (v.trigger === "sticky") {
    if (e.type === "wrap") {
      if (typeof e.template !== "string" || !e.template.includes(WRAP_INPUT_TOKEN)) return null;
      return {
        id: v.id,
        label: v.label,
        showLabel: v.showLabel !== false,
        trigger: "sticky",
        effect: { type: "wrap", template: e.template },
      };
    }
    if (e.type === "reminder") {
      if (typeof e.text !== "string") return null;
      return {
        id: v.id,
        label: v.label,
        showLabel: v.showLabel !== false,
        trigger: "sticky",
        effect: { type: "reminder", text: e.text },
      };
    }
    return null;
  }
  return null;
}

export function parseChassisState(raw: string): ParsedChassisState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { actions: [], dropped: 0 };
  }
  if (typeof parsed !== "object" || parsed === null) return { actions: [], dropped: 0 };
  const rawActions = (parsed as Record<string, unknown>).actions;
  if (!Array.isArray(rawActions)) return { actions: [], dropped: 0 };
  const actions: ChassisAction[] = [];
  let dropped = 0;
  for (const entry of rawActions) {
    const action = parseAction(entry);
    if (action) actions.push(action);
    else dropped += 1;
  }
  return { actions, dropped };
}
