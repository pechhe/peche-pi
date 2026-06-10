import type { RefObject, ReactElement } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ChassisAction } from "./chassis";
import type { ComposerMode } from "./composer-mode";
import type { CavemanLevel } from "./ipc";

/** Built-in control IDs that must exist in every layout. */
export const REQUIRED_UNIT_IDS = ["builtin:send", "builtin:reasoning", "builtin:model"] as const;

/** A placeable control unit in the composer - built-in or chassis action. */
export interface ComposerControlUnit {
  readonly id: string;
  readonly kind: "builtin" | "chassis";
  /** Display name for the unit. */
  readonly label: string;
  /** Default column span when first placed. */
  readonly defaultSpan: number;
  /** Render the control with given props. */
  readonly render: (props: ComposerControlUnitRenderProps) => ReactElement;
}

/** Props passed to control unit render functions. */
export interface ComposerControlUnitRenderProps {
  readonly runtime?: RuntimeSnapshot;
  readonly provider?: string;
  readonly modelId?: string;
  readonly thinkingLevel?: string;
  readonly cavemanLevel: CavemanLevel;
  readonly composerMode: ComposerMode;
  readonly orchestratorMode?: boolean;
  readonly disabled?: boolean;
  readonly modelSelectorRef?: RefObject<any>;
  readonly dropdownPlacement?: "above" | "below";
  readonly showEmptyModelControl?: boolean;
  readonly unselectedModelLabel?: string;
  readonly emptyModelLabel?: string;
  readonly emptyModelTitle?: string;
  readonly onSetComposerMode: (mode: ComposerMode) => void;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onSetCavemanLevel: (level: CavemanLevel) => void;
  readonly onToggleOrchestrator?: () => void;
  readonly chassisAction?: ChassisAction;
  readonly onRunChassisAction?: (action: ChassisAction) => void;
  readonly activeWrapId?: string | null;
  readonly onToggleChassisWrap?: (action: ChassisAction) => void;
  readonly showLabel: boolean;
  readonly color?: string;
}

/** Placement of a unit in the grid. */
export interface ComposerUnitPlacement {
  readonly unitId: string;
  /** Zero-based row index. */
  readonly row: number;
  /** Zero-based column index. */
  readonly col: number;
  readonly colSpan: number;
  /** Per-placement color override. */
  readonly color?: string;
  /** Per-placement label visibility override. */
  readonly showLabel?: boolean;
}

/** Persisted layout structure. */
export interface ComposerLayoutData {
  readonly version: 1;
  readonly cols: 12;
  readonly placements: readonly ComposerUnitPlacement[];
}

/** Registry of all available control units. */
export class ComposerControlUnitRegistry {
  private units = new Map<string, ComposerControlUnit>();

  register(unit: ComposerControlUnit): void {
    this.units.set(unit.id, unit);
  }

  unregister(id: string): void {
    this.units.delete(id);
  }

  get(id: string): ComposerControlUnit | undefined {
    return this.units.get(id);
  }

  getAll(): ComposerControlUnit[] {
    return Array.from(this.units.values());
  }

  /** Get all units matching the given kind. */
  getAllByKind(kind: "builtin" | "chassis"): ComposerControlUnit[] {
    return this.getAll().filter(unit => unit.kind === kind);
  }
}

/** The global control unit registry instance. */
export const controlUnitRegistry = new ComposerControlUnitRegistry();

/**
 * Validate and repair a composer layout:
 * - Drop dangling unit references
 * - Auto-insert missing required units
 * - Fix invalid positions
 */
export function validateComposerLayout(
  layout: unknown,
  availableUnitIds: Set<string>
): ComposerLayoutData {
  // Start with default if invalid
  if (!isValidLayoutData(layout)) {
    return getDefaultLayout();
  }

  const validPlacements: ComposerUnitPlacement[] = [];
  const seenRequiredIds = new Set<string>();

  // Validate each placement
  for (const placement of layout.placements) {
    // Drop dangling references
    if (!availableUnitIds.has(placement.unitId)) {
      continue;
    }

    // Track required units
    if (REQUIRED_UNIT_IDS.includes(placement.unitId as any)) {
      seenRequiredIds.add(placement.unitId);
    }

    // Fix invalid positions
    const validPlacement: ComposerUnitPlacement = {
      unitId: placement.unitId,
      row: Math.max(0, Math.floor(placement.row)),
      col: Math.max(0, Math.min(11, Math.floor(placement.col))),
      colSpan: Math.max(1, Math.min(12 - placement.col, Math.floor(placement.colSpan))),
      color: placement.color,
      showLabel: placement.showLabel,
    };

    validPlacements.push(validPlacement);
  }

  // Auto-insert missing required units
  let nextCol = 0;
  let nextRow = validPlacements.length > 0 ? Math.max(...validPlacements.map(p => p.row)) + 1 : 0;

  for (const requiredId of REQUIRED_UNIT_IDS) {
    if (!seenRequiredIds.has(requiredId)) {
      const unit = controlUnitRegistry.get(requiredId);
      if (unit) {
        // Place on next available position
        if (nextCol + unit.defaultSpan > 12) {
          nextCol = 0;
          nextRow++;
        }
        
        validPlacements.push({
          unitId: requiredId,
          row: nextRow,
          col: nextCol,
          colSpan: unit.defaultSpan,
        });
        
        nextCol += unit.defaultSpan;
      }
    }
  }

  return {
    version: 1,
    cols: 12,
    placements: validPlacements,
  };
}

function isValidLayoutData(layout: unknown): layout is ComposerLayoutData {
  if (typeof layout !== "object" || layout === null) return false;
  const l = layout as any;
  return (
    l.version === 1 &&
    l.cols === 12 &&
    Array.isArray(l.placements) &&
    l.placements.every(isValidPlacement)
  );
}

function isValidPlacement(placement: unknown): placement is ComposerUnitPlacement {
  if (typeof placement !== "object" || placement === null) return false;
  const p = placement as any;
  return (
    typeof p.unitId === "string" &&
    typeof p.row === "number" &&
    typeof p.col === "number" &&
    typeof p.colSpan === "number" &&
    (p.color === undefined || typeof p.color === "string") &&
    (p.showLabel === undefined || typeof p.showLabel === "boolean")
  );
}

/**
 * Get the default layout that reproduces today's control row.
 * This must match the current order exactly for parity.
 */
export function getDefaultLayout(): ComposerLayoutData {
  // Based on current ComposerControlRow order:
  // mode · model · reasoning (caveman) · orchestrate · [chassis actions] · feature badges
  // Send button is separate on the right
  return {
    version: 1,
    cols: 12,
    placements: [
      { unitId: "builtin:mode", row: 0, col: 0, colSpan: 2 },
      { unitId: "builtin:model", row: 0, col: 2, colSpan: 3 },
      { unitId: "builtin:reasoning", row: 0, col: 5, colSpan: 2 },
      { unitId: "builtin:orchestrate", row: 0, col: 7, colSpan: 2 },
      // Feature badges on far left
      { unitId: "builtin:badges", row: 0, col: 9, colSpan: 2 },
      // Send on far right
      { unitId: "builtin:send", row: 0, col: 11, colSpan: 1 },
    ],
  };
}

/**
 * Merge chassis actions into a layout by appending them after built-ins.
 * Used for migration when existing chassis actions need to be added.
 */
export function mergeChassisActionsIntoLayout(
  layout: ComposerLayoutData,
  chassisActions: readonly ChassisAction[]
): ComposerLayoutData {
  if (chassisActions.length === 0) {
    return layout;
  }

  const newPlacements = [...layout.placements];
  
  // Find the last non-send placement row/col
  let maxRow = 0;
  let lastCol = 0;
  
  for (const placement of layout.placements) {
    if (placement.unitId !== "builtin:send") {
      if (placement.row > maxRow) {
        maxRow = placement.row;
        lastCol = placement.col + placement.colSpan;
      } else if (placement.row === maxRow) {
        lastCol = Math.max(lastCol, placement.col + placement.colSpan);
      }
    }
  }

  // Add chassis actions
  let currentRow = maxRow;
  let currentCol = lastCol;
  
  for (const action of chassisActions) {
    const unitId = `chassis:${action.id}`;
    
    // Check if already placed
    if (newPlacements.some(p => p.unitId === unitId)) {
      continue;
    }

    // Default span for chassis actions
    const span = 2;
    
    // Move to next row if needed
    if (currentCol + span > 11) { // Leave room for send button
      currentRow++;
      currentCol = 0;
    }
    
    newPlacements.push({
      unitId,
      row: currentRow,
      col: currentCol,
      colSpan: span,
    });
    
    currentCol += span;
  }

  return {
    ...layout,
    placements: newPlacements,
  };
}

/**
 * Compute effective style for a control by merging device mode defaults with placement overrides.
 */
export function getEffectiveControlStyle(
  placement: ComposerUnitPlacement,
  deviceModeDefaults: {
    readonly showLabel?: boolean;
    readonly color?: string;
  }
): {
  readonly showLabel: boolean;
  readonly color?: string;
} {
  return {
    showLabel: placement.showLabel ?? deviceModeDefaults.showLabel ?? true,
    color: placement.color ?? deviceModeDefaults.color,
  };
}