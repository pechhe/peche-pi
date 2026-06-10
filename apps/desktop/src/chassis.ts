export interface ChassisSubmitEffect {
  readonly type: "submit";
  readonly text: string;
}

export type ChassisEffect = ChassisSubmitEffect;

export interface ChassisAction {
  readonly id: string;
  readonly label: string;
  readonly showLabel: boolean;
  readonly trigger: "oneShot";
  readonly effect: ChassisEffect;
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
  if (v.trigger !== "oneShot") return null;
  const effect = v.effect;
  if (typeof effect !== "object" || effect === null) return null;
  const e = effect as Record<string, unknown>;
  if (e.type !== "submit" || typeof e.text !== "string") return null;
  return {
    id: v.id,
    label: v.label,
    showLabel: v.showLabel !== false,
    trigger: "oneShot",
    effect: { type: "submit", text: e.text },
  };
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
