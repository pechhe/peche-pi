import { useState, useCallback, useMemo } from "react";
import type { ComposerLayoutData } from "./composer-layout";
import { controlUnitRegistry, validateComposerLayout, getDefaultLayout, REQUIRED_UNIT_IDS } from "./composer-layout";
import type { EditLayoutState, EditLayoutActions } from "./edit-layout-context";
import "./composer-builtin-units"; // Register built-in units

/**
 * Hook that manages composer layout edit state.
 * Used by App.tsx to provide context + render overlay UI.
 */
export function useEditLayoutController(currentLayout: ComposerLayoutData) {
  const [workingLayout, setWorkingLayout] = useState<ComposerLayoutData>(currentLayout);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const allUnits = useMemo(() => controlUnitRegistry.getAll(), []);

  const selectUnit = useCallback((unitId: string | null) => {
    setSelectedUnitId(unitId);
  }, []);

  const moveUnit = useCallback((unitId: string, newRow: number, newCol: number) => {
    setWorkingLayout(prev => ({
      ...prev,
      placements: prev.placements.map(p =>
        p.unitId === unitId ? { ...p, row: newRow, col: newCol } : p
      ),
    }));
    setDirty(true);
  }, []);

  const removeUnit = useCallback((unitId: string) => {
    setWorkingLayout(prev => ({
      ...prev,
      placements: prev.placements.filter(p => p.unitId !== unitId),
    }));
    setSelectedUnitId(null);
    setDirty(true);
  }, []);

  const addUnit = useCallback((unitId: string, row: number, col: number, colSpan?: number) => {
    const unit = controlUnitRegistry.get(unitId);
    setWorkingLayout(prev => ({
      ...prev,
      placements: [...prev.placements, {
        unitId,
        row,
        col,
        colSpan: colSpan ?? unit?.defaultSpan ?? 2,
      }],
    }));
    setDirty(true);
  }, []);

  const updateUnitStyle = useCallback((unitId: string, updates: { showLabel?: boolean; color?: string }) => {
    setWorkingLayout(prev => ({
      ...prev,
      placements: prev.placements.map(p =>
        p.unitId === unitId ? { ...p, ...updates } : p
      ),
    }));
    setDirty(true);
  }, []);

  const setWorkingLayoutFn = useCallback((layout: ComposerLayoutData) => {
    setWorkingLayout(layout);
    setDirty(true);
  }, []);

  const save = useCallback(() => {
    const availableIds = new Set(allUnits.map(u => u.id));
    return validateComposerLayout(workingLayout, availableIds);
  }, [workingLayout, allUnits]);

  const revert = useCallback(() => {
    setWorkingLayout(currentLayout);
    setSelectedUnitId(null);
    setDirty(false);
  }, [currentLayout]);

  const reset = useCallback(() => {
    setWorkingLayout(getDefaultLayout());
    setSelectedUnitId(null);
    setDirty(true);
  }, []);

  const state: EditLayoutState = useMemo(() => ({
    active: true,
    workingLayout,
    selectedUnitId,
    dirty,
  }), [workingLayout, selectedUnitId, dirty]);

  const actions: EditLayoutActions = useMemo(() => ({
    setWorkingLayout: setWorkingLayoutFn,
    selectUnit,
    moveUnit,
    removeUnit,
    addUnit,
    updateUnitStyle,
    save: () => {}, // save is handled by the caller
    revert,
    reset,
    deactivate: () => {}, // deactivate is handled by the caller
  }), [setWorkingLayoutFn, selectUnit, moveUnit, removeUnit, addUnit, updateUnitStyle, revert, reset]);

  return { state, actions, save, revert, reset, workingLayout, dirty, selectedUnitId, setSelectedUnitId, allUnits };
}
