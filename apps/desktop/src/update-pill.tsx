import { useEffect, useState } from "react";
import type { PiDesktopApi, UpdateState } from "./ipc";

interface UpdatePillProps {
  readonly api: PiDesktopApi;
}

export function UpdatePill({ api }: UpdatePillProps) {
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);

  useEffect(() => {
    const unsubscribe = api.onUpdateStateChanged((state) => {
      setUpdateState(state);
    });
    return unsubscribe;
  }, [api]);

  // Don't show pill when up-to-date or checking
  if (!updateState || updateState.status === "up-to-date" || updateState.status === "checking") {
    return null;
  }

  if (updateState.status === "update-available") {
    return (
      <button
        className="update-pill update-pill--available"
        type="button"
        onClick={() => void api.triggerDownloadUpdate()}
        title={`Update to v${updateState.latestVersion}`}
      >
        Update
      </button>
    );
  }

  if (updateState.status === "downloading") {
    return (
      <div className="update-pill update-pill--downloading" title={`Downloading... ${updateState.downloadProgress ?? 0}%`}>
        <span className="update-pill__spinner" />
        {updateState.downloadProgress != null ? `${updateState.downloadProgress}%` : "Downloading…"}
      </div>
    );
  }

  if (updateState.status === "downloaded") {
    return (
      <button
        className="update-pill update-pill--ready"
        type="button"
        onClick={() => void api.triggerRestartToInstall()}
        title="Restart to install update"
      >
        Restart to update
      </button>
    );
  }

  if (updateState.status === "error") {
    return (
      <button
        className="update-pill update-pill--error"
        type="button"
        onClick={() => void api.triggerCheckForUpdate()}
        title={updateState.errorMessage ?? "Update check failed"}
      >
        Update failed
      </button>
    );
  }

  return null;
}
