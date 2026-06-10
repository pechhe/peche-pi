import { ComposerModeSelector } from "./composer-mode-selector";
import { ModelSelector } from "./model-selector";
import { CavemanSelector } from "./caveman-selector";
import { OrchestrateSwitch } from "./orchestrate-switch";
import { ModelFeatureBadges } from "./model-feature-badges";
import { ChassisActionControl } from "./chassis-action-control";
import { ArrowUpIcon } from "./icons";
import { controlUnitRegistry } from "./composer-layout";

// Register built-in control units

// Mode selector (plan/build)
controlUnitRegistry.register({
  id: "builtin:mode",
  kind: "builtin",
  label: "Mode",
  defaultSpan: 2,
  render: (props) => (
    <ComposerModeSelector 
      mode={props.composerMode} 
      disabled={props.disabled} 
      onSetMode={props.onSetComposerMode}
    />
  ),
});

// Model selector
controlUnitRegistry.register({
  id: "builtin:model",
  kind: "builtin",
  label: "Model",
  defaultSpan: 3,
  render: (props) => (
    <ModelSelector
      ref={props.modelSelectorRef as any}
      runtime={props.runtime}
      provider={props.provider}
      modelId={props.modelId}
      thinkingLevel={props.thinkingLevel}
      disabled={props.disabled}
      dropdownPlacement={props.dropdownPlacement}
      showEmptyModelControl={props.showEmptyModelControl}
      unselectedModelLabel={props.unselectedModelLabel}
      emptyModelLabel={props.emptyModelLabel}
      emptyModelTitle={props.emptyModelTitle}
      onSetModel={props.onSetModel}
      onSetThinking={props.onSetThinking}
    />
  ),
});

// Reasoning selector (caveman)
controlUnitRegistry.register({
  id: "builtin:reasoning",
  kind: "builtin",
  label: "Reasoning",
  defaultSpan: 2,
  render: (props) => (
    <CavemanSelector 
      level={props.cavemanLevel} 
      disabled={props.disabled} 
      onSetLevel={props.onSetCavemanLevel}
    />
  ),
});

// Orchestrate switch
controlUnitRegistry.register({
  id: "builtin:orchestrate",
  kind: "builtin",
  label: "Orchestrate",
  defaultSpan: 2,
  render: (props) => (
    <OrchestrateSwitch 
      on={props.orchestratorMode ?? false} 
      disabled={props.disabled} 
      onToggle={props.onToggleOrchestrator}
    />
  ),
});

// Model feature badges
controlUnitRegistry.register({
  id: "builtin:badges",
  kind: "builtin",
  label: "Features",
  defaultSpan: 2,
  render: (props) => (
    <ModelFeatureBadges 
      runtime={props.runtime} 
      provider={props.provider} 
      modelId={props.modelId}
    />
  ),
});

// Send button - special handling as it's a required control
// Note: The send button is handled specially in ComposerLayoutRenderer
// because it needs access to onSubmit and primaryActionIsStop from the parent
controlUnitRegistry.register({
  id: "builtin:send",
  kind: "builtin",
  label: "Send",
  defaultSpan: 1,
  render: (_props) => {
    // This is never actually rendered - the layout renderer has special handling for send
    return <></>;
  },
});

/**
 * Register chassis actions as control units dynamically.
 * Call this whenever chassis actions change.
 */
export function registerChassisActionUnits(chassisActions: readonly import("./chassis").ChassisAction[]): void {
  // Remove old chassis units first
  const existingUnits = controlUnitRegistry.getAllByKind("chassis");
  for (const unit of existingUnits) {
    controlUnitRegistry.unregister(unit.id);
  }

  // Register new ones
  for (const action of chassisActions) {
    controlUnitRegistry.register({
      id: `chassis:${action.id}`,
      kind: "chassis",
      label: action.label,
      defaultSpan: 2,
      render: (props) => {
        if (!props.chassisAction) return <></>;
        
        if (action.trigger === "sticky") {
          return (
            <ChassisActionControl
              action={props.chassisAction}
              disabled={props.disabled}
              active={props.activeWrapId === action.id}
              onToggle={() => props.onToggleChassisWrap?.(props.chassisAction!)}
            />
          );
        }
        
        return (
          <ChassisActionControl
            action={props.chassisAction}
            disabled={props.disabled}
            onRun={() => props.onRunChassisAction?.(props.chassisAction!)}
          />
        );
      },
    });
  }
}