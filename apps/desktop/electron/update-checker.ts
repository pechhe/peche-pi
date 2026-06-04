import { app, dialog, Notification } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";

// electron-updater resolves the GitHub provider from the electron-builder.yml
// publish config automatically.

export type UpdateCheckResult =
  | { status: "up-to-date"; currentVersion: string; latestVersion: string }
  | { status: "update-available"; currentVersion: string; latestVersion: string }
  | { status: "downloading"; currentVersion: string; latestVersion: string }
  | { status: "downloaded"; currentVersion: string; latestVersion: string }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let updateDownloaded = false;
let pendingUpdateInfo: UpdateInfo | null = null;

// ---------------------------------------------------------------------------
// Auto-updater wiring
// ---------------------------------------------------------------------------
export function initAutoUpdater(): void {
  // Don't auto-download — we'll trigger it ourselves so we can show progress.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Use the GitHub provider from electron-builder.yml publish config.
  // feedURL is set automatically by electron-updater from the build config.

  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] Checking for update...");
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    console.log(`[updater] Update available: ${info.version}`);
    // Ask the user if they want to download and install.
    promptForDownload(info);
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] App is up to date.");
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log(`[updater] Download progress: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    console.log(`[updater] Update downloaded: ${info.version}`);
    updateDownloaded = true;
    pendingUpdateInfo = info;
    showDownloadedNotification(info);
  });

  autoUpdater.on("error", (err: Error) => {
    console.error("[updater] Error:", err.message);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Check for updates silently (called periodically and on manual trigger). */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();

  try {
    // If we already downloaded an update, just report it.
    if (updateDownloaded && pendingUpdateInfo) {
      return {
        status: "downloaded",
        currentVersion,
        latestVersion: pendingUpdateInfo.version,
      };
    }

    const result = await autoUpdater.checkForUpdates();

    if (!result || !result.updateInfo) {
      return { status: "up-to-date", currentVersion, latestVersion: currentVersion };
    }

    const latestVersion = result.updateInfo.version;
    if (latestVersion === currentVersion) {
      return { status: "up-to-date", currentVersion, latestVersion };
    }

    return { status: "update-available", currentVersion, latestVersion };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", message };
  }
}

/** Trigger download of a pending update (called after user confirms). */
export async function downloadUpdate(): Promise<void> {
  try {
    await autoUpdater.downloadUpdate();
  } catch (err: unknown) {
    console.error("[updater] Download failed:", err instanceof Error ? err.message : err);
  }
}

/** Quit and install a downloaded update. Called from before-quit or menu. */
export function quitAndInstall(): void {
  if (!updateDownloaded) {
    return;
  }
  // Quit silently — electron-updater handles the rest via autoInstallOnAppQuit.
  autoUpdater.quitAndInstall(false, true);
}
// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function promptForDownload(info: UpdateInfo): void {
  const currentVersion = app.getVersion();
  const window = getMainWindow();

  const options = {
    type: "info" as const,
    title: "Update Available",
    message: `A new version of pi-gui is available.`,
    detail: `Version ${info.version} is ready to download (you have ${currentVersion}).\n\nWould you like to download and install it now?`,
    buttons: ["Download & Install", "Later"],
    defaultId: 0,
    cancelId: 1,
  };

  const show = window && !window.isDestroyed()
    ? dialog.showMessageBox(window, options)
    : dialog.showMessageBox(options);

  show.then(({ response }) => {
    if (response === 0) {
      void downloadUpdate();
    }
  });
}

function showDownloadedNotification(info: UpdateInfo): void {
  const notification = new Notification({
    title: "pi-gui Update Ready",
    body: `Version ${info.version} has been downloaded and will be installed on next restart.`,
  });
  notification.on("click", () => {
    // Show the main window so the user can see the restart prompt.
    const window = getMainWindow();
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
    }
  });
  notification.show();
}

function getMainWindow(): Electron.BrowserWindow | undefined {
  const { BrowserWindow } = require("electron") as typeof import("electron");
  const windows = BrowserWindow.getAllWindows();
  return windows.find((w) => !w.isDestroyed()) ?? undefined;
}

// ---------------------------------------------------------------------------
// Periodic check
// ---------------------------------------------------------------------------
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INITIAL_DELAY_MS = 30_000; // 30 seconds after launch

let checkTimer: ReturnType<typeof setTimeout> | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;

export function startPeriodicChecks(): () => void {
  checkTimer = setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((err: unknown) => {
      console.warn("[updater] Periodic check failed:", err instanceof Error ? err.message : err);
    });
  }, INITIAL_DELAY_MS);

  checkInterval = setInterval(() => {
    void autoUpdater.checkForUpdates().catch((err: unknown) => {
      console.warn("[updater] Periodic check failed:", err instanceof Error ? err.message : err);
    });
  }, CHECK_INTERVAL_MS);

  return () => {
    if (checkTimer) {
      clearTimeout(checkTimer);
      checkTimer = null;
    }
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  };
}
