import { memo, type CSSProperties } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ComposerLayoutData, ComposerControlUnitRenderProps } from "./composer-layout";
import { controlUnitRegistry, getEffectiveControlStyle, REQUIRED_UNIT_IDS } from "./composer-layout";
import type { ComposerMode } from "./composer-mode";
import type { CavemanLevel } from "./ipc";
import type { ChassisAction } from "./chassis";
import type { ModelSelectorHandle } from "./model-selector";

interface ComposerLayoutRendererProps {
  readonly layout: ComposerLayoutData;
  readonly runtime?: RuntimeSnapshot;
  readonly provider?: string;
  readonly modelId?: string;
  readonly thinkingLevel?: string;
  readonly cavemanLevel: CavemanLevel;
  readonly composerMode: ComposerMode;
  readonly orchestratorMode?: boolean;
  readonly disabled?: boolean;
  readonly modelSelectorRef?: React.RefObject<ModelSelectorHandle | null>;
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
  readonly chassisActions?: readonly ChassisAction[];
  readonly onRunChassisAction?: (action: ChassisAction) => void;
  readonly activeWrapId?: string | null;
  readonly onToggleChassisWrap?: (action: ChassisAction) => void;
  readonly onSubmit?: () => void;
  readonly primaryActionIsStop?: boolean;
  readonly hasModelSelection?: boolean;
}

/**
 * Renders the composer control layout using CSS Grid.
 * Replaces the hardcoded ComposerControlRow with a flexible grid system.
 */
export const ComposerLayoutRenderer = memo(function ComposerLayoutRenderer({
  layout,
  runtime,
  provider,
  modelId,
  thinkingLevel,
  cavemanLevel,
  composerMode,
  orchestratorMode,
  disabled,
  modelSelectorRef,
  dropdownPlacement,
  showEmptyModelControl,
  unselectedModelLabel,
  emptyModelLabel,
  emptyModelTitle,
  onSetComposerMode,
  onSetModel,
  onSetThinking,
  onSetCavemanLevel,
  onToggleOrchestrator,
  chassisActions,
  onRunChassisAction,
  activeWrapId,
  onToggleChassisWrap,
  onSubmit,
  primaryActionIsStop,
  hasModelSelection,
}: ComposerLayoutRendererProps) {
  // Group placements by row
  const rowCount = Math.max(0, ...layout.placements.map(p => p.row)) + 1;
  
  // Build render props for all units
  const baseRenderProps: Omit<ComposerControlUnitRenderProps, "showLabel" | "color" | "chassisAction"> = {
    runtime,
    provider,
    modelId,
    thinkingLevel,
    cavemanLevel,
    composerMode,
    orchestratorMode,
    disabled,
    modelSelectorRef,
    dropdownPlacement,
    showEmptyModelControl,
    unselectedModelLabel,
    emptyModelLabel,
    emptyModelTitle,
    onSetComposerMode,
    onSetModel,
    onSetThinking,
    onSetCavemanLevel,
    onToggleOrchestrator,
    onRunChassisAction,
    activeWrapId,
    onToggleChassisWrap,
  };

  // For now, use simple defaults for device mode
  // In the future, this would come from the active device mode
  const deviceModeDefaults = {
    showLabel: true,
    color: undefined,
  };

  return (
    <div
      className="composer-layout-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(12, 1fr)",
        gridTemplateRows: `repeat(${rowCount}, auto)`,
        gap: "8px",
        alignItems: "center",
        width: "100%",
      } as CSSProperties}
    >
      {layout.placements.map((placement) => {
        const unit = controlUnitRegistry.get(placement.unitId);
        if (!unit) return null;

        const effectiveStyle = getEffectiveControlStyle(placement, deviceModeDefaults);
        
        // Special handling for send button to pass submit handler
        const isUnitSend = placement.unitId === "builtin:send";
        
        // Find matching chassis action if this is a chassis unit
        const chassisAction = placement.unitId.startsWith("chassis:")
          ? chassisActions?.find(a => `chassis:${a.id}` === placement.unitId)
          : undefined;

        const style: CSSProperties = {
          gridRow: placement.row + 1,
          gridColumn: `${placement.col + 1} / span ${placement.colSpan}`,
        };

        // Apply custom color if specified
        if (effectiveStyle.color) {
          (style as any)["--control-color"] = effectiveStyle.color;
        }

        return (
          <div
            key={`${placement.unitId}-${placement.row}-${placement.col}`}
            className={`composer-layout-cell ${isUnitSend ? "composer-layout-cell--send" : ""}`}
            style={style}
            data-unit-id={placement.unitId}
            data-required={REQUIRED_UNIT_IDS.includes(placement.unitId as any) ? "" : undefined}
          >
            {isUnitSend && onSubmit ? (
              // Special handling for send button
              <button
                aria-label={primaryActionIsStop ? "Stop run" : "Send message"}
                className="button button--primary button--cta-icon composer__send"
                data-testid="send"
                type="button"
                disabled={!primaryActionIsStop && !hasModelSelection}
                onPointerDown={() => { (window as any).playClick?.("down"); }}
                onClick={onSubmit}
              >
                {primaryActionIsStop ? (
                  // Would import StopSquareIcon here
                  <span>■</span>
                ) : (
                  // Would import ArrowUpIcon here
                  <span>↑</span>
                )}
              </button>
            ) : (
              // Regular unit rendering
              <span className="composer-control-wrapper">
                {unit.render({
                  ...baseRenderProps,
                  chassisAction,
                  showLabel: effectiveStyle.showLabel,
                  color: effectiveStyle.color,
                })}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});

/**
 * Backwards-compatible wrapper that renders controls in the old linear style.
 * Used during migration to ensure visual parity.
 */
export const ComposerLayoutLegacyRow = memo(function ComposerLayoutLegacyRow(
  props: ComposerLayoutRendererProps
) {
  // For the legacy row, we ignore the grid layout and render linearly
  const { layout, ...renderProps } = props;
  
  return (
    <span className="composer__controls">
      {layout.placements
        .filter(p => p.unitId !== "builtin:send") // Send is handled separately
        .sort((a, b) => {
          // Sort by row then column to maintain order
          if (a.row !== b.row) return a.row - b.row;
          return a.col - b.col;
        })
        .map((placement, index) => {
          const unit = controlUnitRegistry.get(placement.unitId);
          if (!unit) return null;

          const effectiveStyle = getEffectiveControlStyle(placement, { showLabel: true });
          const chassisAction = placement.unitId.startsWith("chassis:")
            ? props.chassisActions?.find(a => `chassis:${a.id}` === placement.unitId)
            : undefined;

          return (
            <span key={placement.unitId}>
              {index > 0 && <span className="composer__controls-sep">{" \u00b7 "}</span>}
              {unit.render({
                ...renderProps,
                chassisAction,
                showLabel: effectiveStyle.showLabel,
                color: effectiveStyle.color,
              } as any)}
            </span>
          );
        })}
    </span>
  );
});