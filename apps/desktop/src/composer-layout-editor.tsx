import type { ComposerUnitPlacement } from "./composer-layout";
import { controlUnitRegistry, REQUIRED_UNIT_IDS } from "./composer-layout";
import { useEditLayoutState, useEditLayoutActions } from "./edit-layout-context";
import "./composer-builtin-units"; // Register built-in units

const cn = (...classes: (string | boolean | undefined)[]) =>
  classes.filter(Boolean).join(" ");

/**
 * Floating toolbar, palette, and inspector for inline edit mode.
 * Renders as fixed-position panels around the real composer.
 * Requires EditLayoutStateContext and EditLayoutActionsContext to be provided
 * by a parent (typically App.tsx).
 */
export function ComposerLayoutToolbar() {
  const state = useEditLayoutState();
  const actions = useEditLayoutActions();

  if (!state.active || !actions) return null;

  return (
    <div className="composer-layout-toolbar" data-testid="composer-layout-toolbar">
      <span className="composer-layout-toolbar__title">Editing layout</span>
      <div className="composer-layout-toolbar__actions">
        <button
          className="composer-layout-toolbar__btn composer-layout-toolbar__btn--secondary"
          onClick={actions.reset}
        >
          Reset
        </button>
        <button
          className="composer-layout-toolbar__btn composer-layout-toolbar__btn--secondary"
          onClick={actions.revert}
          disabled={!state.dirty}
        >
          Revert
        </button>
        <button
          className="composer-layout-toolbar__btn composer-layout-toolbar__btn--primary"
          onClick={actions.save}
          disabled={!state.dirty}
        >
          Save
        </button>
        <button
          className="composer-layout-toolbar__btn composer-layout-toolbar__btn--ghost"
          onClick={actions.deactivate}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function ComposerLayoutPalette() {
  const state = useEditLayoutState();
  const actions = useEditLayoutActions();

  if (!state.active || !actions) return null;

  const allUnits = controlUnitRegistry.getAll();
  const placedUnitIds = new Set(state.workingLayout?.placements.map(p => p.unitId) ?? []);
  const builtinUnits = allUnits.filter(u => u.kind === "builtin");
  const chassisUnits = allUnits.filter(u => u.kind === "chassis");

  return (
    <div className="composer-layout-palette" data-testid="composer-layout-palette">
      <h3 className="composer-layout-palette__heading">Your Tools</h3>
      <div className="composer-layout-palette__section">
        <span className="composer-layout-palette__section-label">Built-in</span>
        {builtinUnits.map((unit) => (
          <PaletteItem
            key={unit.id}
            unitId={unit.id}
            label={unit.label}
            icon="⚙"
            isPlaced={placedUnitIds.has(unit.id)}
            onAdd={() => actions.addUnit(unit.id, 0, 0)}
          />
        ))}
      </div>
      {chassisUnits.length > 0 && (
        <div className="composer-layout-palette__section">
          <span className="composer-layout-palette__section-label">Actions</span>
          {chassisUnits.map((unit) => (
            <PaletteItem
              key={unit.id}
              unitId={unit.id}
              label={unit.label}
              icon="⚡"
              isPlaced={placedUnitIds.has(unit.id)}
              onAdd={() => actions.addUnit(unit.id, 0, 0)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PaletteItem({
  unitId,
  label,
  icon,
  isPlaced,
  onAdd,
}: {
  readonly unitId: string;
  readonly label: string;
  readonly icon: string;
  readonly isPlaced: boolean;
  readonly onAdd: () => void;
}) {
  return (
    <div
      className={cn(
        "composer-layout-palette__item",
        isPlaced && "composer-layout-palette__item--placed"
      )}
      data-unit-id={unitId}
    >
      <span className="composer-layout-palette__item-icon">{icon}</span>
      <span className="composer-layout-palette__item-label">{label}</span>
      {isPlaced ? (
        <span className="composer-layout-palette__item-badge">✓</span>
      ) : (
        <button
          className="composer-layout-palette__item-add"
          onClick={onAdd}
          title={`Add ${label}`}
        >
          +
        </button>
      )}
    </div>
  );
}

export function ComposerLayoutInspector() {
  const state = useEditLayoutState();
  const actions = useEditLayoutActions();

  if (!state.active || !actions) return null;

  const selectedPlacement = state.workingLayout?.placements.find(p => p.unitId === state.selectedUnitId);
  const selectedUnit = selectedPlacement ? controlUnitRegistry.get(selectedPlacement.unitId) : undefined;
  const isRequiredUnit = selectedPlacement ? REQUIRED_UNIT_IDS.includes(selectedPlacement.unitId as any) : false;

  if (selectedPlacement && selectedUnit) {
    return (
      <div className="composer-layout-inspector" data-testid="composer-layout-inspector">
        <div className="composer-layout-inspector__header">
          <h3 className="composer-layout-inspector__title">{selectedUnit.label}</h3>
          {isRequiredUnit && (
            <span className="composer-layout-inspector__badge">Required</span>
          )}
        </div>

        <div className="composer-layout-inspector__field">
          <label>Width</label>
          <input
            type="range"
            min="1"
            max={12 - (selectedPlacement.col ?? 0)}
            value={selectedPlacement.colSpan ?? 2}
            onChange={(e) => actions.updateUnitStyle(state.selectedUnitId!, {})}
          />
          <span className="composer-layout-inspector__value">×{selectedPlacement.colSpan ?? 2}</span>
        </div>

        <div className="composer-layout-inspector__field">
          <label>
            <input
              type="checkbox"
              checked={selectedPlacement.showLabel ?? true}
              onChange={(e) => actions.updateUnitStyle(state.selectedUnitId!, { showLabel: e.target.checked })}
            />
            Show label
          </label>
        </div>

        {!isRequiredUnit && (
          <button
            className="composer-layout-inspector__remove"
            onClick={() => actions.removeUnit(state.selectedUnitId!)}
          >
            Remove control
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="composer-layout-inspector composer-layout-inspector--empty" data-testid="composer-layout-inspector">
      <p className="composer-layout-inspector__empty-text">Select a control to edit</p>
    </div>
  );
}

// Legacy export for utility-surface.tsx compatibility (no longer used — edit mode is inline)
export function ComposerLayoutEditor(_props: any) {
  return null;
}
