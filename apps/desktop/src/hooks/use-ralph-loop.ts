import type { Dispatch, SetStateAction } from "react";
import type {
  DesktopAppState,
  RalphPlanSummary,
  SessionRecord,
  WorkspaceRecord,
} from "../desktop-state";
import type { LoopControlProps } from "../composer-panel";

// ---------------------------------------------------------------------------
// Ralph loop: when a Ralph plan exists for the selected workspace and the
// selected thread is the active loop iteration, surface a locked loop control
// bar instead of the composer.  Otherwise, surface a "Begin Ralph loop" banner
// that opens the launch dialog (model + iteration picker) before starting a
// dedicated loop thread.
// ---------------------------------------------------------------------------

export interface RalphLaunch {
  plan: RalphPlanSummary;
  provider: string | undefined;
  modelId: string | undefined;
  thinkingLevel: string | undefined;
  maxIterations: number;
}

export function useRalphLoop(
  snapshot: DesktopAppState | null,
  selectedSession: SessionRecord | undefined,
  selectedWorkspace: WorkspaceRecord | undefined,
  api: NonNullable<typeof window.piApp>,
  setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
  updateSnapshot: (
    api: NonNullable<typeof window.piApp>,
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>,
  resolvedSessionProvider: string | undefined,
  resolvedSessionModelId: string | undefined,
  resolvedSessionThinkingLevel: string | undefined,
  ralphLaunch: RalphLaunch | null,
  setRalphLaunch: Dispatch<SetStateAction<RalphLaunch | null>>,
) {
  // When the selected thread is the active iteration of a Ralph loop, replace
  // the composer with a locked control bar so the loop cannot be interrupted.
  const selectedLoopStatus = snapshot?.selectedLoopStatus;
  const sendLoopCommand = (command: string) =>
    void updateSnapshot(api, setSnapshot, () => api.submitComposer(command));
  const loopControl: LoopControlProps | undefined =
    selectedLoopStatus && selectedLoopStatus.isSelectedSessionActive
      ? {
          status: selectedLoopStatus,
          onStop: () => sendLoopCommand("/ralph-stop"),
          onResume: () => sendLoopCommand("/ralph-resume"),
          onRestart: () => sendLoopCommand("/ralph-restart"),
        }
      : undefined;

  // Once a Ralph plan has been written, the plan's workspace exposes it on
  // `ralphPlans`. Surface a "Begin Ralph loop" banner on the chat composer
  // (hidden while a loop already owns the thread). Beginning starts a fresh
  // thread — the special loop thread — and runs the bundle-mode loop there.
  const selectedRalphPlan: RalphPlanSummary | undefined =
    !loopControl && selectedSession && snapshot?.selectedSessionCreatedRalphPlan
      ? selectedWorkspace?.ralphPlans?.[0]
      : undefined;
  const beginRalphLoop = selectedRalphPlan
    ? {
        planTitle: selectedRalphPlan.title,
        onBegin: () =>
          setRalphLaunch({
            plan: selectedRalphPlan,
            provider: resolvedSessionProvider,
            modelId: resolvedSessionModelId,
            thinkingLevel: resolvedSessionThinkingLevel,
            maxIterations: selectedRalphPlan.defaultMaxIterations,
          }),
      }
    : undefined;
  const runRalphLoop = () => {
    const launch = ralphLaunch;
    const workspaceId = selectedWorkspace?.id;
    if (!launch || !workspaceId) {
      return;
    }
    setRalphLaunch(null);
    void updateSnapshot(api, setSnapshot, () =>
      api.startThread({
        rootWorkspaceId: workspaceId,
        environment: "local",
        provider: launch.provider,
        modelId: launch.modelId,
        thinkingLevel: launch.thinkingLevel,
      }),
    ).then(() => {
      void api.submitComposer(
        `/ralph-loop "${launch.plan.promptRef}" --max-iterations=${launch.maxIterations}`,
      );
    });
  };

  return { loopControl, beginRalphLoop, runRalphLoop };
}
