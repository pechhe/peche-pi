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

/** Candidate produced by the Composer Layout Builder — same as ChassisAction but without id. */
export interface ChassisActionCandidate {
  readonly label: string;
  readonly showLabel: boolean;
  readonly trigger: "oneShot" | "sticky";
  readonly effect: ChassisEffect;
}

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

/** Per-folder Chassis state: the folder's action definitions + its sticky activation. */
export interface ChassisFolderState {
  readonly actions: ChassisAction[];
  /** Id of the active sticky action in this folder, or null. Never per-thread. */
  readonly activeStickyId: string | null;
}

/** Folder-keyed Chassis file (schema v2): map from project-folder path → folder state. */
export type ChassisFile = Record<string, ChassisFolderState>;

const EMPTY_FOLDER_STATE: ChassisFolderState = { actions: [], activeStickyId: null };

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

function parseActionList(rawActions: unknown): ChassisAction[] {
  if (!Array.isArray(rawActions)) return [];
  const actions: ChassisAction[] = [];
  for (const entry of rawActions) {
    const action = parseAction(entry);
    if (action) actions.push(action);
  }
  return actions;
}

/**
 * Validate a raw object as a Chassis Action Candidate (without id).
 * Used by the Composer Layout Builder to gate model output.
 * Returns the typed candidate or a human-readable error string.
 */
export function validateChassisActionCandidate(
  value: unknown,
): { readonly valid: true; readonly action: Omit<ChassisAction, "id"> } | { readonly valid: false; readonly error: string } {
  if (typeof value !== "object" || value === null) {
    return { valid: false, error: "Candidate must be a JSON object." };
  }
  const v = value as Record<string, unknown>;
  if (typeof v.label !== "string" || v.label.length === 0) {
    return { valid: false, error: "Candidate must have a non-empty \"label\" string." };
  }
  const showLabel = v.showLabel !== false;
  const effect = v.effect;
  if (typeof effect !== "object" || effect === null) {
    return { valid: false, error: "Candidate must have an \"effect\" object." };
  }
  const e = effect as Record<string, unknown>;
  if (v.trigger === "oneShot") {
    if (e.type !== "submit" || typeof e.text !== "string") {
      return { valid: false, error: "oneShot trigger requires effect.type=\"submit\" and a \"text\" string." };
    }
    return { valid: true, action: { label: v.label, showLabel, trigger: "oneShot", effect: { type: "submit", text: e.text } } };
  }
  if (v.trigger === "sticky") {
    if (e.type === "wrap") {
      if (typeof e.template !== "string" || !e.template.includes(WRAP_INPUT_TOKEN)) {
        return { valid: false, error: `sticky/wrap effect.template must be a string containing ${WRAP_INPUT_TOKEN}.` };
      }
      return { valid: true, action: { label: v.label, showLabel, trigger: "sticky", effect: { type: "wrap", template: e.template } } };
    }
    if (e.type === "reminder") {
      if (typeof e.text !== "string") {
        return { valid: false, error: "sticky/reminder effect must have a \"text\" string." };
      }
      return { valid: true, action: { label: v.label, showLabel, trigger: "sticky", effect: { type: "reminder", text: e.text } } };
    }
    return { valid: false, error: 'sticky trigger requires effect.type "wrap" or "reminder".' };
  }
  return { valid: false, error: 'trigger must be "oneShot" or "sticky".' };
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
  const actions = parseActionList(rawActions);
  return { actions, dropped: rawActions.length - actions.length };
}

/**
 * Parse the folder-keyed Chassis file (schema v2). Each folder's actions are
 * validated (malformed entries dropped); an activeStickyId that no longer
 * matches a surviving action is nulled. Invalid JSON or non-v2 shapes yield an
 * empty record — never throws.
 */
export function parseChassisFile(raw: string): ChassisFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const p = parsed as Record<string, unknown>;
  if (p.version !== 2 || typeof p.folders !== "object" || p.folders === null) return {};
  const out: Record<string, ChassisFolderState> = {};
  for (const [folderPath, value] of Object.entries(p.folders as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const v = value as Record<string, unknown>;
    const actions = parseActionList(v.actions);
    const rawActive = typeof v.activeStickyId === "string" ? v.activeStickyId : null;
    const activeStickyId = actions.some((a) => a.id === rawActive) ? rawActive : null;
    out[folderPath] = { actions, activeStickyId };
  }
  return out;
}

/** Resolve a folder's state, falling back to an empty set + no activation. */
export function resolveFolderState(file: ChassisFile, folderPath: string): ChassisFolderState {
  return file[folderPath] ?? EMPTY_FOLDER_STATE;
}

/** Serialize a folder-keyed Chassis file (schema v2), revalidating every folder. */
export function serializeChassisFile(file: ChassisFile): string {
  const folders: Record<string, ChassisFolderState> = {};
  for (const [folderPath, state] of Object.entries(file)) {
    const actions = parseActionList(state.actions);
    const activeStickyId = actions.some((a) => a.id === state.activeStickyId) ? state.activeStickyId : null;
    folders[folderPath] = { actions, activeStickyId };
  }
  return `${JSON.stringify({ version: 2, folders }, null, 2)}\n`;
}
