import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SelectedTranscriptRecord } from "../desktop-state";

/**
 * Self-heal: if a session is selected but its transcript never arrived (a
 * main-side publish can be dropped if it fires before the renderer's IPC
 * listener is attached, or coalesced and stranded), re-request it directly
 * instead of staying stuck on the loading bar until the user switches
 * threads and back.
 */
export function useSelfHealTranscript(
  isTranscriptLoading: boolean,
  workspaceId: string | undefined,
  sessionId: string | undefined,
  setSelectedTranscript: Dispatch<SetStateAction<SelectedTranscriptRecord | null>>,
): void {
  useEffect(() => {
    if (!isTranscriptLoading || !workspaceId || !sessionId) {
      return undefined;
    }
    const api = window.piApp;
    if (!api) {
      return undefined;
    }
    let cancelled = false;
    const refetch = () => {
      void api.getSelectedTranscript().then((transcript) => {
        if (
          cancelled ||
          !transcript ||
          transcript.workspaceId !== workspaceId ||
          transcript.sessionId !== sessionId
        ) {
          return;
        }
        setSelectedTranscript(transcript);
      });
    };
    // First attempt shortly after detecting the stuck state, then a backstop
    // retry in case hydration is still in flight on the main side.
    const first = window.setTimeout(refetch, 200);
    const second = window.setTimeout(refetch, 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [isTranscriptLoading, workspaceId, sessionId, setSelectedTranscript]);
}
