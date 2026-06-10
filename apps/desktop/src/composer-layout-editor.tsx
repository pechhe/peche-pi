import { useState, useRef, useEffect, useCallback } from "react";
import type { ComposerLayoutData, ComposerUnitPlacement, ComposerControlUnit } from "./composer-layout";
import { controlUnitRegistry, validateComposerLayout, getDefaultLayout, getEffectiveControlStyle, REQUIRED_UNIT_IDS } from "./composer-layout";
import { ComposerLayoutRenderer } from "./composer-layout-renderer";
import type { ComposerDeviceMode } from "./desktop-state";
import "./composer-builtin-units"; // Register built-in units
// Simple classname utility
const cn = (...classes: (string | boolean | undefined)[]) => 
  classes.filter(Boolean).join(" ");

interface ComposerLayoutEditorProps {
  readonly currentLayout: ComposerLayoutData;
  readonly deviceMode: ComposerDeviceMode;
  readonly onSave: (layout: ComposerLayoutData) => void;
  readonly onBack: () => void;
}

interface DragState {
  readonly unitId: string;
  readonly fromPalette: boolean;
  readonly startRow?: number;
  readonly startCol?: number;
}

interface DropTarget {
  readonly row: number;
  readonly col: number;
  readonly colSpan: number;
}

export function ComposerLayoutEditor(props: ComposerLayoutEditorProps) {
  const { currentLayout, deviceMode, onSave, onBack } = props;
  
  const [workingLayout, setWorkingLayout] = useState<ComposerLayoutData>(currentLayout);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  
  const gridRef = useRef<HTMLDivElement>(null);
  
  // Get all available units
  const allUnits = controlUnitRegistry.getAll();
  const placedUnitIds = new Set(workingLayout.placements.map(p => p.unitId));
  const availableUnits = allUnits.filter(unit => !placedUnitIds.has(unit.id));
  
  // Selected placement
  const selectedPlacement = workingLayout.placements.find(p => p.unitId === selectedPlacementId);
  const selectedUnit = selectedPlacement ? controlUnitRegistry.get(selectedPlacement.unitId) : undefined;
  const isRequiredUnit = selectedPlacement ? REQUIRED_UNIT_IDS.includes(selectedPlacement.unitId as any) : false;

  // Device mode defaults for preview
  const deviceModeDefaults = {
    showLabel: deviceMode === "modular-cream",
    color: undefined, // Let CSS handle device mode colors
  };

  // Grid calculations
  const calculateDropTarget = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!gridRef.current || !dragState) return null;

    const rect = gridRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const cellWidth = rect.width / 12;
    const cellHeight = 48; // Approximate height of a control row
    
    const col = Math.floor(x / cellWidth);
    const row = Math.floor(y / cellHeight);
    
    const unit = controlUnitRegistry.get(dragState.unitId);
    const colSpan = unit?.defaultSpan ?? 2;
    
    // Clamp to grid bounds
    const targetCol = Math.max(0, Math.min(12 - colSpan, col));
    const targetRow = Math.max(0, row);
    
    return { row: targetRow, col: targetCol, colSpan };
  }, [dragState]);

  // Handlers
  const handleDragStart = useCallback((e: React.DragEvent, unitId: string, fromPalette: boolean, placement?: ComposerUnitPlacement) => {
    setDragState({ 
      unitId, 
      fromPalette,
      startRow: placement?.row,
      startCol: placement?.col
    });
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = calculateDropTarget(e);
    setDropTarget(target);
  }, [calculateDropTarget]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    
    if (!dragState || !dropTarget) return;
    
    const newPlacements = [...workingLayout.placements];
    
    if (dragState.fromPalette) {
      // Add new placement
      newPlacements.push({
        unitId: dragState.unitId,
        row: dropTarget.row,
        col: dropTarget.col,
        colSpan: dropTarget.colSpan,
      });
    } else {
      // Move existing placement
      const index = newPlacements.findIndex(p => p.unitId === dragState.unitId);
      if (index !== -1) {
        const existing = newPlacements[index];
        if (existing) {
          newPlacements[index] = {
            unitId: existing.unitId,
            row: dropTarget.row,
            col: dropTarget.col,
            colSpan: existing.colSpan,
            color: existing.color,
            showLabel: existing.showLabel,
          };
        }
      }
    }
    
    setWorkingLayout({
      ...workingLayout,
      placements: newPlacements,
    });
    setIsDirty(true);
    setDragState(null);
    setDropTarget(null);
  }, [dragState, dropTarget, workingLayout]);

  const handleDragEnd = useCallback(() => {
    setDragState(null);
    setDropTarget(null);
  }, []);

  const handleRemovePlacement = useCallback(() => {
    if (!selectedPlacementId || isRequiredUnit) return;
    
    setWorkingLayout({
      ...workingLayout,
      placements: workingLayout.placements.filter(p => p.unitId !== selectedPlacementId),
    });
    setSelectedPlacementId(null);
    setIsDirty(true);
  }, [selectedPlacementId, isRequiredUnit, workingLayout]);

  const handleUpdatePlacement = useCallback((updates: Partial<ComposerUnitPlacement>) => {
    if (!selectedPlacementId) return;
    
    setWorkingLayout({
      ...workingLayout,
      placements: workingLayout.placements.map(p =>
        p.unitId === selectedPlacementId ? { ...p, ...updates } : p
      ),
    });
    setIsDirty(true);
  }, [selectedPlacementId, workingLayout]);

  const handleSave = useCallback(() => {
    const availableIds = new Set(allUnits.map(u => u.id));
    const validatedLayout = validateComposerLayout(workingLayout, availableIds);
    onSave(validatedLayout);
    setIsDirty(false);
  }, [workingLayout, allUnits, onSave]);

  const handleRevert = useCallback(() => {
    setWorkingLayout(currentLayout);
    setSelectedPlacementId(null);
    setIsDirty(false);
  }, [currentLayout]);

  const handleReset = useCallback(() => {
    setWorkingLayout(getDefaultLayout());
    setSelectedPlacementId(null);
    setIsDirty(true);
  }, []);

  return (
    <div className="composer-layout-editor">
      {/* Header */}
      <div className="composer-layout-editor__header">
        <button className="composer-layout-editor__back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
          Back
        </button>
        <h1 className="composer-layout-editor__title">Composer Layout</h1>
        <div className="composer-layout-editor__actions">
          <button 
            className="composer-layout-editor__action composer-layout-editor__action--secondary"
            onClick={handleReset}
          >
            Reset to default
          </button>
          <button 
            className="composer-layout-editor__action composer-layout-editor__action--secondary"
            onClick={handleRevert}
            disabled={!isDirty}
          >
            Revert
          </button>
          <button 
            className="composer-layout-editor__action composer-layout-editor__action--primary"
            onClick={handleSave}
            disabled={!isDirty}
          >
            Save
          </button>
        </div>
      </div>

      <div className="composer-layout-editor__body">
        {/* Preview */}
        <div className="composer-layout-editor__preview-section">
          <h2 className="composer-layout-editor__section-title">Preview</h2>
          <div className="composer-layout-editor__device-frame">
            <div 
              className={cn(
                "composer-layout-editor__preview",
                `composer--device-${deviceMode}`
              )}
              ref={gridRef}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              {/* Ghost preview during drag */}
              {dropTarget && dragState && (
                <div
                  className="composer-layout-editor__drop-ghost"
                  style={{
                    gridRow: dropTarget.row + 1,
                    gridColumn: `${dropTarget.col + 1} / span ${dropTarget.colSpan}`,
                  }}
                />
              )}
              
              {/* Render actual layout with click handlers */}
              <div className="composer-layout-grid">
                {workingLayout.placements.map((placement) => {
                  const unit = controlUnitRegistry.get(placement.unitId);
                  if (!unit) return null;
                  
                  const effectiveStyle = getEffectiveControlStyle(placement, deviceModeDefaults);
                  const isSelected = placement.unitId === selectedPlacementId;
                  
                  return (
                    <div
                      key={placement.unitId}
                      className={cn(
                        "composer-layout-cell",
                        "composer-layout-editor__cell",
                        isSelected && "composer-layout-editor__cell--selected"
                      )}
                      style={{
                        gridRow: placement.row + 1,
                        gridColumn: `${placement.col + 1} / span ${placement.colSpan}`,
                      }}
                      data-unit-id={placement.unitId}
                      data-required={REQUIRED_UNIT_IDS.includes(placement.unitId as any) || undefined}
                      draggable
                      onClick={() => setSelectedPlacementId(placement.unitId)}
                      onDragStart={(e) => handleDragStart(e, placement.unitId, false, placement)}
                      onDragEnd={handleDragEnd}
                    >
                      {unit.render({
                        showLabel: effectiveStyle.showLabel,
                        color: effectiveStyle.color,
                        disabled: false,
                        cavemanLevel: "off",
                        composerMode: "build",
                        onSetComposerMode: () => {},
                        onSetModel: () => {},
                        onSetThinking: () => {},
                        onSetCavemanLevel: () => {},
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {workingLayout.placements.length === 0 && (
            <p className="composer-layout-editor__empty-message">
              Drag controls from the palette to start building your layout
            </p>
          )}
        </div>

        {/* Palette */}
        <div className="composer-layout-editor__palette-section">
          <h2 className="composer-layout-editor__section-title">Available Controls</h2>
          <div className="composer-layout-editor__palette">
            {availableUnits.length === 0 ? (
              <p className="composer-layout-editor__palette-empty">All controls are placed</p>
            ) : (
              availableUnits.map((unit) => (
                <div
                  key={unit.id}
                  className="composer-layout-editor__palette-item"
                  draggable
                  onDragStart={(e) => handleDragStart(e, unit.id, true)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="composer-layout-editor__palette-item-icon">
                    {unit.kind === "builtin" ? "⚙" : "⚡"}
                  </div>
                  <div className="composer-layout-editor__palette-item-label">{unit.label}</div>
                  <div className="composer-layout-editor__palette-item-span">×{unit.defaultSpan}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Inspector */}
        <div className="composer-layout-editor__inspector-section">
          <h2 className="composer-layout-editor__section-title">Inspector</h2>
          {selectedPlacement && selectedUnit ? (
            <div className="composer-layout-editor__inspector">
              <div className="composer-layout-editor__inspector-header">
                <h3 className="composer-layout-editor__inspector-title">{selectedUnit.label}</h3>
                {isRequiredUnit && (
                  <span className="composer-layout-editor__inspector-badge">Required</span>
                )}
              </div>
              
              <div className="composer-layout-editor__inspector-field">
                <label>Width</label>
                <input
                  type="range"
                  min="1"
                  max={12 - selectedPlacement.col}
                  value={selectedPlacement.colSpan}
                  onChange={(e) => handleUpdatePlacement({ colSpan: parseInt(e.target.value) })}
                />
                <span className="composer-layout-editor__inspector-value">×{selectedPlacement.colSpan}</span>
              </div>
              
              <div className="composer-layout-editor__inspector-field">
                <label>
                  <input
                    type="checkbox"
                    checked={selectedPlacement.showLabel ?? deviceModeDefaults.showLabel}
                    onChange={(e) => handleUpdatePlacement({ showLabel: e.target.checked })}
                  />
                  Show label
                </label>
              </div>
              
              <div className="composer-layout-editor__inspector-field">
                <label>Color override</label>
                <div className="composer-layout-editor__color-swatches">
                  <button
                    className={cn(
                      "composer-layout-editor__color-swatch",
                      !selectedPlacement.color && "composer-layout-editor__color-swatch--selected"
                    )}
                    onClick={() => handleUpdatePlacement({ color: undefined })}
                    title="Default"
                  >
                    <span className="composer-layout-editor__color-auto">Auto</span>
                  </button>
                  {["#4A5568", "#E53E3E", "#38A169", "#3182CE", "#805AD5", "#D69E2E"].map((color) => (
                    <button
                      key={color}
                      className={cn(
                        "composer-layout-editor__color-swatch",
                        selectedPlacement.color === color && "composer-layout-editor__color-swatch--selected"
                      )}
                      style={{ backgroundColor: color }}
                      onClick={() => handleUpdatePlacement({ color })}
                      title={color}
                    />
                  ))}
                </div>
              </div>
              
              {!isRequiredUnit && (
                <button
                  className="composer-layout-editor__remove-button"
                  onClick={handleRemovePlacement}
                >
                  Remove control
                </button>
              )}
            </div>
          ) : (
            <p className="composer-layout-editor__inspector-empty">
              Select a control to edit its properties
            </p>
          )}
        </div>
      </div>
    </div>
  );
}