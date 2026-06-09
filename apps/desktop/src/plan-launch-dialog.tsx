import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { ModelSelector } from "./model-selector";
import { playButtonClick, playButtonSecondary } from "./button-click-sound";

export interface PlanLaunchDialogProps {
  readonly planTitle: string;
  readonly issueCount: number;
  readonly runtime: RuntimeSnapshot | undefined;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onCancel: () => void;
  readonly onRun: () => void;
}

/**
 * Dialog shown before starting plan execution.
 * Lets the user pick the model/reasoning for all issue sessions.
 */
export function PlanLaunchDialog({
  planTitle,
  issueCount,
  runtime,
  provider,
  modelId,
  thinkingLevel,
  onSetModel,
  onSetThinking,
  onCancel,
  onRun,
}: PlanLaunchDialogProps) {
  return (
    <div className="extension-dialog-backdrop" onClick={onCancel}>
      <div className="extension-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="extension-dialog__title">Start plan</div>
        <p className="extension-dialog__body">
          {planTitle} — {issueCount} issue{issueCount !== 1 ? "s" : ""}
        </p>

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

        <div className="extension-dialog__actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              playButtonSecondary();
              onCancel();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              playButtonClick();
              onRun();
            }}
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
