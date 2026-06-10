import { createContext, useContext } from "react";
import type { ComposerLayoutData } from "./composer-layout";

export interface EditLayoutState {
  active: boolean;
  workingLayout: ComposerLayoutData | null;
  selectedUnitId: string | null;
  dirty: boolean;
}

export interface EditLayoutActions {
  setWorkingLayout: (layout: ComposerLayoutData) => void;
  selectUnit: (unitId: string | null) => void;
  moveUnit: (unitId: string, newRow: number, newCol: number) => void;
  removeUnit: (unitId: string) => void;
  addUnit: (unitId: string, row: number, col: number, colSpan?: number) => void;
  updateUnitStyle: (unitId: string, updates: { showLabel?: boolean; color?: string }) => void;
  save: () => void;
  revert: () => void;
  reset: () => void;
  deactivate: () => void;
}

const EditLayoutStateContext = createContext<EditLayoutState>({
  active: false, workingLayout: null, selectedUnitId: null, dirty: false,
});
const EditLayoutActionsContext = createContext<EditLayoutActions | null>(null);

export function useEditLayoutState() { return useContext(EditLayoutStateContext); }
export function useEditLayoutActions() { return useContext(EditLayoutActionsContext); }
export { EditLayoutStateContext, EditLayoutActionsContext };
