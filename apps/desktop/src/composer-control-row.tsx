import { memo, type RefObject } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { CavemanSelector } from "./caveman-selector";
import { ComposerModeSelector } from "./composer-mode-selector";
import type { ComposerMode } from "./composer-mode";
import type { CavemanLevel } from "./ipc";
import { ModelFeatureBadges } from "./model-feature-badges";
import { ModelSelector, type ModelSelectorHandle } from "./model-selector";
import { OrchestrateSwitch } from "./orchestrate-switch";
import type { ChassisAction } from "./chassis";
import { ChassisActionControl } from "./chassis-action-control";

interface ComposerControlRowProps {
  readonly runtime: RuntimeSnapshot | undefined;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly cavemanLevel: CavemanLevel;
  readonly composerMode: ComposerMode;
  readonly orchestratorMode?: boolean;
  readonly disabled?: boolean;
  readonly modelSelectorRef?: RefObject<ModelSelectorHandle | null>;
  /** ModelSelector display variations (new-thread surface differs from in-thread). */
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
}

/**
 * The shared composer control cluster: plan/build mode, model selector,
 * caveman dial, and model feature badges. Rendered identically across the
 * in-thread composer (composer-panel), the new-thread surface
 * (new-thread-view), and the disabled pending placeholder (pending-thread-view).
 *
 * Memoized: none of these props change while the composer draft is being
 * typed, so wrapping in memo lets the whole control cluster (model selector,
 * caveman dial, badges) bail out of the per-keystroke re-render.
 */
export const ComposerControlRow = memo(function ComposerControlRow({
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
}: ComposerControlRowProps) {
  return (
    <span className="composer__controls">
      <span className="composer__controls-sep">{" \u00b7 "}</span>
      <ComposerModeSelector mode={composerMode} disabled={disabled} onSetMode={onSetComposerMode} />
      <span className="composer__controls-sep">{" \u00b7 "}</span>
      <ModelSelector
        ref={modelSelectorRef}
        runtime={runtime}
        provider={provider}
        modelId={modelId}
        thinkingLevel={thinkingLevel}
        disabled={disabled}
        dropdownPlacement={dropdownPlacement}
        showEmptyModelControl={showEmptyModelControl}
        unselectedModelLabel={unselectedModelLabel}
        emptyModelLabel={emptyModelLabel}
        emptyModelTitle={emptyModelTitle}
        onSetModel={onSetModel}
        onSetThinking={onSetThinking}
      />
      <span className="composer__controls-sep">{" \u00b7 "}</span>
      <CavemanSelector level={cavemanLevel} disabled={disabled} onSetLevel={onSetCavemanLevel} />
      <span className="composer__controls-sep">{" \u00b7 "}</span>
      <OrchestrateSwitch on={orchestratorMode ?? false} disabled={disabled} onToggle={onToggleOrchestrator} />
      {chassisActions?.map((action) => (
        <span key={action.id}>
          <span className="composer__controls-sep">{" \u00b7 "}</span>
          {action.trigger === "sticky" ? (
            <ChassisActionControl
              action={action}
              disabled={disabled}
              active={activeWrapId === action.id}
              onToggle={() => onToggleChassisWrap?.(action)}
            />
          ) : (
            <ChassisActionControl
              action={action}
              disabled={disabled}
              onRun={() => onRunChassisAction?.(action)}
            />
          )}
        </span>
      ))}
      <ModelFeatureBadges runtime={runtime} provider={provider} modelId={modelId} />
    </span>
  );
});
