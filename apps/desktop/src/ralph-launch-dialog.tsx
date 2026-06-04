import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { ModelSelector } from "./model-selector";
import { playButtonClick, playButtonSecondary } from "./button-click-sound";

export interface RalphLaunchDialogProps {
  readonly planTitle: string;
  readonly runtime: RuntimeSnapshot | undefined;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly maxIterations: number;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onSetMaxIterations: (maxIterations: number) => void;
  readonly onCancel: () => void;
  readonly onRun: () => void;
}

/**
 * Small dialog shown before a Ralph loop is launched, letting the user pick the
 * model/reasoning and iteration budget for the loop thread.
 */
export function RalphLaunchDialog({
  planTitle,
  runtime,
  provider,
  modelId,
  thinkingLevel,
  maxIterations,
  onSetModel,
  onSetThinking,
  onSetMaxIterations,
  onCancel,
  onRun,
}: RalphLaunchDialogProps) {
  return (
    <div className="extension-dialog-backdrop" onClick={onCancel}>
      <div className="extension-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="extension-dialog__title">Begin Ralph loop</div>
        <p className="extension-dialog__body">{planTitle}</p>

        <div className="ralph-launch__field">
          <span className="ralph-launch__label">Model</span>
          <ModelSelector
            runtime={runtime}
            provider={provider}
            modelId={modelId}
            thinkingLevel={thinkingLevel}
            dropdownPlacement="below"
            showEmptyModelControl
            onSetModel={onSetModel}
            onSetThinking={onSetThinking}
          />
        </div>

        <div className="ralph-launch__field">
          <span className="ralph-launch__label">Max iterations</span>
          <input
            type="number"
            min={1}
            className="ralph-launch__input"
            value={maxIterations}
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10);
              onSetMaxIterations(Number.isFinite(next) && next >= 1 ? next : 1);
            }}
          />
        </div>

        <div className="extension-dialog__actions">
          <button type="button" className="button" onClick={() => { playButtonSecondary(); onCancel(); }}>
            Cancel
          </button>
          <button type="button" className="button button--primary" onClick={() => { playButtonClick(); onRun(); }}>
            Run loop
          </button>
        </div>
      </div>
    </div>
  );
}
