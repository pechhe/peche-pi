import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  nativeImage,
  shell,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
} from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DesktopAppStore } from "./app-store";
import { getChangedFiles, getFileDiff, getWorkspaceGitInfo, redoEdits, stageFile, undoEdits } from "./app-store-diff";
import { configureCommitPushLogDir, executeCommitPush } from "./commit-push-service";
import {
  configurePrLogDir,
  createPullRequest,
  generatePrDraft,
  getWorkspacePrInfo,
} from "./pr-service";
import { listWorkspaceFiles } from "./app-store-files";
import { MAIN_DEV_RELOAD_MARKER } from "./dev-reload-main-probe";
import { NotificationManager } from "./notification-manager";
import {
  NotificationPermissionService,
} from "./notification-permission";
import { checkForUpdate, initAutoUpdater, quitAndInstall, startPeriodicChecks } from "./update-checker";
import { ThemeManager } from "./theme-manager";
import { TerminalService } from "./terminal-service";
import type { DesktopAppState, ThemeMode } from "../src/desktop-state";
import { buildContextSnapshot, readContextFiles } from "./context-snapshot";
import type { ComposerMode } from "../src/composer-mode";
import { desktopIpc, getDesktopCommandFromShortcut, type CavemanConfigSnapshot, type CavemanLevel, type UndoEditOp } from "../src/ipc";
import { registerMainHandlers, type MainHandlerAdapters } from "./desktop-ipc-seam-main";
import { SUPPORTED_COMPOSER_IMAGE_TYPES } from "../src/composer-attachments";
import type {
  ComposerAttachment,
  ComposerFileAttachment,
  ComposerImageAttachment,
  CreateSessionInput,
  CreateWorktreeInput,
  RemoveWorktreeInput,
  StartChatInput,
  StartThreadInput,
  WorkspaceSessionTarget,
} from "../src/desktop-state";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import type { GenerateThreadTitleOptions } from "@pi-gui/pi-sdk-driver";
import type { WorkspaceRef } from "@pi-gui/session-driver";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const windowTestMode = resolveWindowTestMode();
const devReloadMarkersEnabled = process.env.PI_APP_DEV_RELOAD_MARKERS === "1";
let store: DesktopAppStore;
const themeManager = new ThemeManager();
let mainWindow: BrowserWindow | null = null;
let notificationManager: NotificationManager | undefined;
let notificationPermissionService: NotificationPermissionService | undefined;
let terminalService: TerminalService | undefined;
let integratedTerminalShell = "";
let stopPublishingState: (() => void) | undefined;
let stopPublishingSelectedTranscript: (() => void) | undefined;
let stopPublishingStatePatch: (() => void) | undefined;
let stopPublishingTranscriptDelta: (() => void) | undefined;
let stopTrackingWindowActivation: (() => void) | undefined;
let stopNotifications: (() => void) | undefined;
let stopPeriodicChecks: (() => void) | undefined;
let stopPruningTerminals: (() => void) | undefined;
let retainedTerminalWorkspacePathSignature = "";
const terminalFocusedWebContentsIds = new Set<number>();
let quittingAfterStoreFlush = false;

const SUPPORTED_IMAGE_TYPES = SUPPORTED_COMPOSER_IMAGE_TYPES;
const SUPPORTED_IMAGE_MIME_TYPES = new Set<string>(SUPPORTED_IMAGE_TYPES.map((type) => type.mimeType));
const OPEN_FOLDER_MENU_ITEM_ID = "file.open-folder";
const CHECK_FOR_UPDATES_MENU_ITEM_ID = "app.check-for-updates";
const MAX_CLIPBOARD_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CLIPBOARD_IMAGE_DIMENSION = 8_192;

function getTerminalService(): TerminalService {
  if (!terminalService) {
    terminalService = new TerminalService({
      getWorkspacePath: (workspaceId) => store.getWorkspacePath(workspaceId),
      getIntegratedTerminalShell: () => integratedTerminalShell,
      isPackaged: app.isPackaged,
    });
  }
  return terminalService;
}

// Resolve the bundled application icon. In dev the repo's `resources/icon.png`
// sits two levels up from the compiled `out/main/main.js`; in a packaged build
// it is copied to `process.resourcesPath` via `extraResources` in
// electron-builder.yml. On macOS packaged builds the window/dock icon already
// comes from `icon.icns` in the app bundle, so we only need the PNG for dev
// and for Linux/Windows window chrome.
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "icon.png")
  : path.join(__dirname, "..", "..", "resources", "icon.png");
const appIcon = nativeImage.createFromPath(appIconPath);

function readClipboardImageAttachment(): ComposerImageAttachment | null {
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return null;
  }

  const size = image.getSize();
  if (size.width > MAX_CLIPBOARD_IMAGE_DIMENSION || size.height > MAX_CLIPBOARD_IMAGE_DIMENSION) {
    return null;
  }

  const png = image.toPNG();
  if (png.length === 0 || png.length > MAX_CLIPBOARD_IMAGE_BYTES) {
    return null;
  }

  return {
    id: randomUUID(),
    kind: "image",
    name: "pasted-image.png",
    mimeType: "image/png",
    data: png.toString("base64"),
  };
}

function createWindow(): BrowserWindow {
  const backgroundTestMode = windowTestMode === "background";
  const enableTransparency = store ? store.state.enableTransparency : false;
  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    transparent: enableTransparency,
    vibrancy: process.platform === "darwin" && enableTransparency ? "under-window" : undefined,
    titleBarStyle: "hiddenInset",
    backgroundColor: enableTransparency ? "#00000000" : "#f3f4f8",
    trafficLightPosition: { x: 18, y: 18 },
    show: false,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep hidden test windows responsive so Playwright exercises the same UI flows.
      backgroundThrottling: !backgroundTestMode,
    },
  });

  window.once("ready-to-show", () => {
    if (!backgroundTestMode) {
      window.show();
    }
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }

    const lowerKey = input.key.toLowerCase();
    const platformModifier = process.platform === "darwin" ? input.meta : input.control;
    const terminalFocused = terminalFocusedWebContentsIds.has(window.webContents.id);
    if (terminalFocused) {
      return;
    }
    if (platformModifier && !input.shift && lowerKey === "o") {
      event.preventDefault();
      void pickWorkspaceViaDialog();
      return;
    }

    if (platformModifier && !input.shift && lowerKey === "v") {
      const clipboardImage = readClipboardImageAttachment();
      if (clipboardImage) {
        event.preventDefault();
        window.webContents.send(desktopIpc.clipboardImagePasted, clipboardImage);
        return;
      }
    }

    const command = getDesktopCommandFromShortcut({
      modifier: process.platform === "darwin" ? input.meta : input.control,
      shift: input.shift,
      key: input.key,
      code: input.code,
    });
    if (command) {
      event.preventDefault();
      window.webContents.send(desktopIpc.appCommand, command);
    }
  });

  if (isDev) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL as string);
    if (process.env.PI_APP_OPEN_DEVTOOLS !== "0") {
      window.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    const indexPath = path.join(__dirname, "..", "renderer", "index.html");
    void window.loadURL(pathToFileURL(indexPath).toString());
  }

  return window;
}

function attachStatePublisher(window: BrowserWindow): void {
  const webContentsId = window.webContents.id;
  stopPublishingState?.();
  stopPublishingSelectedTranscript?.();
  stopPublishingStatePatch?.();
  stopPublishingTranscriptDelta?.();
  stopPublishingState = store.subscribe((state) => {
    if (canPublishToWindow(window)) {
      window.webContents.send(desktopIpc.stateChanged, state);
    }
  });
  stopPublishingSelectedTranscript = store.subscribeToSelectedTranscript((payload) => {
    if (canPublishToWindow(window)) {
      window.webContents.send(desktopIpc.selectedTranscriptChanged, payload);
    }
  });
  stopPublishingStatePatch = store.subscribeToStatePatch((patch) => {
    if (canPublishToWindow(window)) {
      window.webContents.send(desktopIpc.statePatch, patch);
    }
  });
  stopPublishingTranscriptDelta = store.subscribeToTranscriptDelta((delta) => {
    if (canPublishToWindow(window)) {
      window.webContents.send(desktopIpc.transcriptDelta, delta);
    }
  });
  window.webContents.once("render-process-gone", () => {
    stopPublishingState?.();
    stopPublishingState = undefined;
    stopPublishingSelectedTranscript?.();
    stopPublishingSelectedTranscript = undefined;
    stopPublishingStatePatch?.();
    stopPublishingStatePatch = undefined;
    stopPublishingTranscriptDelta?.();
    stopPublishingTranscriptDelta = undefined;
  });
  window.once("closed", () => {
    stopPublishingState?.();
    stopPublishingState = undefined;
    stopPublishingSelectedTranscript?.();
    stopPublishingSelectedTranscript = undefined;
    stopPublishingStatePatch?.();
    stopPublishingStatePatch = undefined;
    stopPublishingTranscriptDelta?.();
    stopPublishingTranscriptDelta = undefined;
    if (mainWindow === window) {
      mainWindow = null;
    }
    terminalFocusedWebContentsIds.delete(webContentsId);
    terminalService?.dispose();
  });
}

function attachViewedSessionTracking(window: BrowserWindow): void {
  stopTrackingWindowActivation?.();

  const handleActivation = () => {
    store.handleWindowActivation();
  };
  const clearTracking = () => {
    stopTrackingWindowActivation?.();
    stopTrackingWindowActivation = undefined;
  };

  window.on("focus", handleActivation);
  window.on("show", handleActivation);
  window.on("restore", handleActivation);
  window.once("closed", clearTracking);

  stopTrackingWindowActivation = () => {
    window.off("focus", handleActivation);
    window.off("show", handleActivation);
    window.off("restore", handleActivation);
    window.off("closed", clearTracking);
  };
}

function canPublishToWindow(window: BrowserWindow): boolean {
  return !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.isCrashed();
}

function resolveWindowTestMode(): "foreground" | "background" {
  return process.env.PI_APP_TEST_MODE?.trim().toLowerCase() === "background" ? "background" : "foreground";
}

async function pickWorkspaceViaDialog(): Promise<DesktopAppState> {
  const window = mainWindow && canPublishToWindow(mainWindow) ? mainWindow : undefined;
  const result = window
    ? await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: "Open workspace folder",
      })
    : await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Open workspace folder",
      });
  if (result.canceled || result.filePaths.length === 0) {
    return store.getState();
  }
  const nextState = await store.addWorkspace(result.filePaths[0] as string);
  if (!nextState.selectedWorkspaceId) {
    return nextState;
  }
  const newThreadState =
    nextState.activeView === "new-thread" ? nextState : await store.setActiveView("new-thread");
  if (window) {
    window.webContents.send(desktopIpc.workspacePicked, nextState.selectedWorkspaceId);
  }
  return newThreadState;
}

async function pickTerminalAppViaDialog(): Promise<string | undefined> {
  // Tests exercise the picker branch without blocking on a native dialog.
  if (process.env.PI_APP_TEST_MODE) {
    return process.env.PI_APP_TEST_TERMINAL_APP || "/System/Applications/Utilities/Terminal.app";
  }
  const window = mainWindow && canPublishToWindow(mainWindow) ? mainWindow : undefined;
  const dialogOptions = {
    properties: ["openFile"] as Array<"openFile">,
    defaultPath: "/Applications",
    title: "Choose a terminal app",
    message: "Pick the terminal application to open pi sessions in (e.g. Terminal, iTerm, Ghostty).",
    filters: [{ name: "Applications", extensions: ["app"] }],
  };
  const result = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || result.filePaths.length === 0) {
    return undefined;
  }
  return result.filePaths[0];
}

async function runManualUpdateCheck(): Promise<void> {
  const window = mainWindow && canPublishToWindow(mainWindow) ? mainWindow : undefined;
  const result = await checkForUpdate();

  if (result.status === "update-available") {
    // autoUpdater already prompted the user via promptForDownload.
    return;
  }

  if (result.status === "up-to-date") {
    const options: MessageBoxOptions = {
      type: "info",
      title: "pi-gui",
      message: `You're up to date on version ${result.currentVersion}.`,
      buttons: ["OK"],
    };
    if (window) {
      await dialog.showMessageBox(window, options);
    } else {
      await dialog.showMessageBox(options);
    }
    return;
  }

  if (result.status === "error") {
    const options: MessageBoxOptions = {
      type: "warning",
      title: "pi-gui",
      message: "Could not check for updates right now.",
      detail: result.message,
      buttons: ["OK"],
    };
    if (window) {
      await dialog.showMessageBox(window, options);
    } else {
      await dialog.showMessageBox(options);
    }
    return;
  }

  // "downloading" or "downloaded" — the auto-updater handles UI for these.
}

function installApplicationMenu(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          id: CHECK_FOR_UPDATES_MENU_ITEM_ID,
          label: "Check for Updates…",
          click: () => {
            void runManualUpdateCheck();
          },
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          id: OPEN_FOLDER_MENU_ITEM_ID,
          label: "Open Folder…",
          accelerator: "Command+O",
          click: () => {
            void pickWorkspaceViaDialog();
          },
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Ensure npm (and other Homebrew/npm-global binaries) are available
// even when pi-gui is launched via Finder/Dock (which has a minimal PATH).
const extraBinPaths = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  `${process.env.HOME}/.npm-global/bin`,
].filter((p) => p);
const currentPath = process.env.PATH ?? "";
const missingPaths = extraBinPaths.filter((p) => !currentPath.split(":").includes(p));
if (missingPaths.length > 0) {
  process.env.PATH = [...missingPaths, currentPath].join(":");
}

app.setName(process.env.PI_APP_NAME?.trim() || "Peche Pi");

const configuredUserDataDir = process.env.PI_APP_USER_DATA_DIR?.trim() || app.getPath("userData");
app.setPath("userData", configuredUserDataDir);
configureCommitPushLogDir(configuredUserDataDir);
configurePrLogDir(configuredUserDataDir);

// Crash log: write uncaught errors to a persistent file in userData.
// This survives before-quit and lets the dev script point users at it.
import { appendFileSync } from "node:fs";
import { format } from "node:util";
const crashLogPath = path.join(configuredUserDataDir, "crash.log");
let crashGuardCount = 0;
function writeCrash(kind: string, error: unknown) {
  if (crashGuardCount >= 10) return;
  crashGuardCount++;
  const line = `[${new Date().toISOString()}] ${kind}: ${format(error)}`;
  try { appendFileSync(crashLogPath, line + "\n"); } catch { /* best-effort */ }
  process.stderr.write(line + "\n");
}
process.on("uncaughtException", (err) => {
  writeCrash("uncaughtException", err.stack ?? err.message);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  writeCrash("unhandledRejection", reason instanceof Error ? (reason.stack ?? reason.message) : reason);
});
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP", "SIGQUIT"]) {
  process.on(sig, () => {
    writeCrash("signal", `Received ${sig}`);
    process.exit(1);
  });
}
process.on("exit", (code) => {
  const msg = `MAIN PROCESS EXIT code=${code}`;
  try { appendFileSync(crashLogPath, `[${new Date().toISOString()}] exit: ${msg}\n`); } catch { /* best-effort */ }
  process.stderr.write(msg + "\n");
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
  }

  // On macOS, packaged builds already render the dock icon from `icon.icns`
  // in the app bundle. In dev we override the generic Electron dock icon with
  // the real PNG so the running app looks right end-to-end.
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(appIcon);
  }

  let generateThreadTitleOverride:
    | ((workspace: WorkspaceRef, options: GenerateThreadTitleOptions) => Promise<string | null | undefined>)
    | undefined;
  let deferredThreadTitle:
    | {
        resolve: (title: string | null) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  store = new DesktopAppStore({
    userDataDir: configuredUserDataDir,
    initialWorkspacePaths: resolveInitialWorkspacePaths(),
    getWindow: () => mainWindow,
    generateThreadTitleOverride: async (workspace, options) => generateThreadTitleOverride?.(workspace, options),
  });
  await store.initialize();
  const initialState = await store.getState();
  integratedTerminalShell = initialState.integratedTerminalShell;
  themeManager.setMode(initialState.themeMode);
  stopPruningTerminals = store.subscribe((state) => {
    integratedTerminalShell = state.integratedTerminalShell;
    const workspacePaths = state.workspaces.map((workspace) => workspace.path);
    const workspacePathSignature = workspacePaths.join("\0");
    if (workspacePathSignature !== retainedTerminalWorkspacePathSignature) {
      retainedTerminalWorkspacePathSignature = workspacePathSignature;
      terminalService?.retainWorkspacePaths(workspacePaths);
    }
  });
  installApplicationMenu();
  if (process.env.PI_APP_TEST_MODE) {
    Object.assign(globalThis, {
      __PI_APP_TEST_HOOKS: {
        emitSessionEvent: (event: SessionDriverEvent) => store.emitTestSessionEvent(event),
        setDeferredThreadTitleMode: () => {
          generateThreadTitleOverride = () =>
            new Promise<string | null>((resolve, reject) => {
              deferredThreadTitle = { resolve, reject };
            });
        },
        hasDeferredThreadTitle: () => Boolean(deferredThreadTitle),
        resolveDeferredThreadTitle: (title: string) => {
          if (!deferredThreadTitle) {
            throw new Error("Deferred thread-title request is unavailable");
          }
          const pending = deferredThreadTitle;
          deferredThreadTitle = undefined;
          pending.resolve(title);
        },
        rejectDeferredThreadTitle: () => {
          if (!deferredThreadTitle) {
            throw new Error("Deferred thread-title request is unavailable");
          }
          const pending = deferredThreadTitle;
          deferredThreadTitle = undefined;
          pending.reject(new Error("Deferred thread-title rejected by test"));
        },
      },
    });
  }
  notificationPermissionService = new NotificationPermissionService(() => mainWindow);
  notificationPermissionService.subscribe((status) => {
    if (mainWindow && canPublishToWindow(mainWindow)) {
      mainWindow.webContents.send(desktopIpc.notificationPermissionStatusChanged, status);
    }
  });
  notificationManager = new NotificationManager(store, () => mainWindow, notificationPermissionService);
  stopNotifications = notificationManager.start();
  if (!isDev) {
    initAutoUpdater();
    stopPeriodicChecks = startPeriodicChecks();
  }

  // ---------------------------------------------------------------------------
  // IPC handler adapters — grouped by adapter, registered from the seam registry
  // ---------------------------------------------------------------------------
  const mainHandlers = {
    handlers: {
      // -- System --
      ping: () => devReloadMarkersEnabled ? `pi desktop ready:${MAIN_DEV_RELOAD_MARKER}` : "pi desktop ready",

      // -- Theme --
      getThemeMode: () => themeManager.getMode(),
      getResolvedTheme: () => themeManager.getResolvedTheme(),
      setThemeMode: (_event: unknown, mode: ThemeMode) => {
        themeManager.setMode(mode);
        void store.setThemeMode(mode);
        return mode;
      },

      // -- Shell --
      openExternal: (_event: unknown, url: string) => shell.openExternal(url),

      // -- Window --
      toggleWindowMaximize: (event: unknown) => {
        const window = BrowserWindow.fromWebContents((event as { sender: Electron.WebContents }).sender);
        if (!window) return;
        if (window.isMaximized()) { window.unmaximize(); return; }
        window.maximize();
      },

      // -- Store (state) --
      getState: () => store.getState(),
      getSelectedTranscript: () => store.getSelectedTranscript().catch(() => null),

      // -- Workspace --
      addWorkspacePath: (_event: unknown, workspacePath: string) => store.addWorkspace(workspacePath),
      pickWorkspace: () => pickWorkspaceViaDialog(),
      selectWorkspace: (_event: unknown, workspaceId: string) => store.selectWorkspace(workspaceId),
      renameWorkspace: (_event: unknown, workspaceId: string, displayName: string) => store.renameWorkspace(workspaceId, displayName),
      removeWorkspace: (_event: unknown, workspaceId: string) => store.removeWorkspace(workspaceId),
      reorderWorkspaces: (_event: unknown, order: readonly string[]) => store.reorderWorkspaces(order),
      openWorkspaceInFinder: async (_event: unknown, workspaceId: string) => {
        const workspacePath = store.getWorkspacePath(workspaceId);
        if (!workspacePath) throw new Error(`Unknown workspace: ${workspaceId}`);
        await shell.openPath(workspacePath);
      },
      createWorktree: (_event: unknown, input: CreateWorktreeInput) => store.createWorktree(input),
      removeWorktree: (_event: unknown, input: RemoveWorktreeInput) => store.removeWorktree(input),
      openSkillInFinder: async (_event: unknown, workspaceId: string, filePath: string) => {
        const resolved = store.getSkillFilePath(workspaceId, filePath);
        if (!resolved) throw new Error(`Unknown skill: ${filePath}`);
        await shell.openPath(path.dirname(resolved));
      },
      openExtensionInFinder: async (_event: unknown, workspaceId: string, filePath: string) => {
        const resolved = store.getExtensionFilePath(workspaceId, filePath);
        if (!resolved) throw new Error(`Unknown extension: ${filePath}`);
        await shell.openPath(path.dirname(resolved));
      },
      syncCurrentWorkspace: () => store.syncCurrentWorkspace(),
      listWorkspaceFiles: async (_event: unknown, workspaceId: string) => {
        const workspacePath = store.getWorkspacePath(workspaceId);
        if (!workspacePath) return [];
        return listWorkspaceFiles(workspacePath);
      },
      getChangedFiles: async (_event: unknown, workspaceId: string) => {
        const workspacePath = store.getWorkspacePath(workspaceId);
        if (!workspacePath) return [];
        return getChangedFiles(workspacePath);
      },
      getWorkspaceGitInfo: async (_event: unknown, workspaceId: string) => {
        const workspacePath = store.getWorkspacePath(workspaceId);
        if (!workspacePath) return { isGitRepo: false, changedCount: 0 };
        return getWorkspaceGitInfo(workspacePath);
      },

      // -- Session --
      selectSession: (_event: unknown, target: WorkspaceSessionTarget) => store.selectSession(target),
      archiveSession: (_event: unknown, target: WorkspaceSessionTarget) => store.archiveSession(target),
      unarchiveSession: (_event: unknown, target: WorkspaceSessionTarget) => store.unarchiveSession(target),
      archiveAllNonRunningSessions: (_event: unknown, workspaceId: string, olderThanMs?: number) =>
        store.archiveAllNonRunningSessions(workspaceId, olderThanMs),
      createSession: (_event: unknown, input: CreateSessionInput) => store.createSession(input),
      startThread: (_event: unknown, input: StartThreadInput) => store.startThread(input),
      cancelCurrentRun: () => store.cancelCurrentRun(),
      openSessionInDefaultTerminal: () => store.openSessionInDefaultTerminal(pickTerminalAppViaDialog),
      chooseExternalTerminalApp: async () => {
        const app = await pickTerminalAppViaDialog();
        return app ? store.setExternalTerminalApp(app) : store.getState();
      },
      clearExternalTerminalApp: () => store.setExternalTerminalApp(""),
      getSessionTree: (_event: unknown, target: WorkspaceSessionTarget) => store.getSessionTree(target),
      navigateSessionTree: (_event: unknown, target: WorkspaceSessionTarget, targetId: string, options: unknown) =>
        store.navigateSessionTree(target, targetId, options as never),

      // -- Store (view/UI) --
      setActiveView: (_event: unknown, activeView: unknown) => store.setActiveView(activeView as never),
      setSidebarCollapsed: (_event: unknown, collapsed: boolean) => store.setSidebarCollapsed(collapsed),
      setQueueMode: (_event: unknown, enabled: boolean) => store.setQueueMode(enabled),
      refreshRuntime: (_event: unknown, workspaceId?: string) => store.refreshRuntime(workspaceId),

      // -- Store (model/settings) --
      setModelSettingsScopeMode: (_event: unknown, mode: unknown) => store.setModelSettingsScopeMode(mode as never),
      setSessionModel: (_event: unknown, workspaceId: string, sessionId: string, provider: string, modelId: string) =>
        store.setSessionModel({ workspaceId, sessionId }, provider, modelId),
      setDefaultModel: (_event: unknown, workspaceId: string, provider: string, modelId: string) =>
        store.setDefaultModel(workspaceId, provider, modelId),
      setDefaultThinkingLevel: (_event: unknown, workspaceId: string, thinkingLevel: unknown) =>
        store.setDefaultThinkingLevel(workspaceId, thinkingLevel as never),
      getCavemanConfig: () => readCavemanConfig(),
      setCavemanDefaultLevel: async (_event: unknown, level: CavemanLevel) => {
        const current = await readCavemanConfig();
        const next = { ...current, defaultLevel: normalizeCavemanLevel(level) };
        await writeCavemanConfig(next);
        return next;
      },
      setSessionThinkingLevel: (_event: unknown, workspaceId: string, sessionId: string, thinkingLevel: unknown) =>
        store.setSessionThinkingLevel({ workspaceId, sessionId }, thinkingLevel as never),

      // -- Store (provider/auth) --
      loginProvider: (_event: unknown, workspaceId: string, providerId: string) =>
        store.loginProvider(workspaceId, providerId, createRuntimeLoginCallbacks()),
      logoutProvider: (_event: unknown, workspaceId: string, providerId: string) =>
        store.logoutProvider(workspaceId, providerId),
      setProviderApiKey: (_event: unknown, workspaceId: string, providerId: string, apiKey: string) =>
        store.setProviderApiKey(workspaceId, providerId, apiKey),

      // -- Store (skills/extensions) --
      setEnableSkillCommands: (_event: unknown, workspaceId: string, enabled: boolean) =>
        store.setEnableSkillCommands(workspaceId, enabled),
      setRetrySettings: (
        _event: unknown,
        workspaceId: string,
        settings: { enabled: boolean; maxRetries: number; baseDelayMs: number },
      ) => store.setRetrySettings(workspaceId, settings),
      getRetrySettings: (_event: unknown, workspaceId: string) =>
        store.getRetrySettings(workspaceId),
      setScopedModelPatterns: (_event: unknown, workspaceId: string, patterns: readonly string[]) =>
        store.setScopedModelPatterns(workspaceId, patterns),
      setSkillEnabled: (_event: unknown, workspaceId: string, filePath: string, enabled: boolean) =>
        store.setSkillEnabled(workspaceId, filePath, enabled),
      setExtensionEnabled: (_event: unknown, workspaceId: string, filePath: string, enabled: boolean) =>
        store.setExtensionEnabled(workspaceId, filePath, enabled),
      deleteExtension: (_event: unknown, workspaceId: string, filePath: string) =>
        store.deleteExtension(workspaceId, filePath),

      // -- Store (host UI) --
      respondToHostUiRequest: (_event: unknown, workspaceId: string, sessionId: string, response: unknown) =>
        store.respondToHostUiRequest({ workspaceId, sessionId }, response as never),

      // -- Notification --
      setNotificationPreferences: (_event: unknown, preferences: unknown) =>
        store.setNotificationPreferences(preferences as never),
      getNotificationPermissionStatus: () =>
        notificationPermissionService?.getCurrentStatus() ?? Promise.resolve("unknown"),
      requestNotificationPermission: () =>
        notificationPermissionService?.requestPermission() ?? Promise.resolve("unknown"),
      openSystemNotificationSettings: () =>
        notificationPermissionService?.openSystemSettings() ?? Promise.resolve(),

      // -- Terminal --
      setIntegratedTerminalShell: (_event: unknown, shellPath: string) =>
        store.setIntegratedTerminalShell(shellPath),
      ensureTerminalPanel: (event: unknown, workspaceId: string, terminalScopeId: string, size: unknown) => {
        const e = event as { sender: Electron.WebContents };
        return getTerminalService().ensurePanel(e.sender, workspaceId, terminalScopeId, size as never);
      },
      createTerminalSession: (event: unknown, workspaceId: string, terminalScopeId: string, size: unknown) => {
        const e = event as { sender: Electron.WebContents };
        return getTerminalService().createSession(e.sender, workspaceId, terminalScopeId, size as never);
      },
      setActiveTerminalSession: (event: unknown, workspaceId: string, terminalScopeId: string, terminalId: string) => {
        const e = event as { sender: Electron.WebContents };
        return getTerminalService().setActiveSession(e.sender, workspaceId, terminalScopeId, terminalId);
      },
      writeTerminal: (event: unknown, terminalId: string, data: string) => {
        terminalService?.write((event as { sender: Electron.WebContents }).sender, terminalId, data);
      },
      resizeTerminal: (event: unknown, terminalId: string, size: unknown) => {
        terminalService?.resize((event as { sender: Electron.WebContents }).sender, terminalId, size as never);
      },
      restartTerminalSession: (event: unknown, terminalId: string, size: unknown) => {
        return getTerminalService().restart((event as { sender: Electron.WebContents }).sender, terminalId, size as never);
      },
      closeTerminalSession: (event: unknown, terminalId: string) => {
        return getTerminalService().close((event as { sender: Electron.WebContents }).sender, terminalId);
      },
      setTerminalTitle: (event: unknown, terminalId: string, title: string) => {
        terminalService?.setTitle((event as { sender: Electron.WebContents }).sender, terminalId, title);
      },
      setTerminalFocused: (event: unknown, focused: boolean) => {
        const e = event as { sender: { id: number } };
        if (focused) { terminalFocusedWebContentsIds.add(e.sender.id); }
        else { terminalFocusedWebContentsIds.delete(e.sender.id); }
      },

      // -- Subagent --
      setSubagentSettings: (_event: unknown, settings: unknown) => store.setSubagentSettings(settings as never),
      refreshSubagentAgents: (_event: unknown, workspaceId: string) => store.refreshSubagentAgents(workspaceId),
      saveSubagentAgent: (_event: unknown, workspaceId: string, input: unknown) =>
        store.saveSubagentAgent(workspaceId, input as never),
      deleteSubagentAgent: (_event: unknown, workspaceId: string, name: string, scope: unknown) =>
        store.deleteSubagentAgent(workspaceId, name, scope as never),

      // -- Store (UI prefs) --
      setEnableTransparency: async (_event: unknown, enabled: boolean) => {
        const nextState = await store.setEnableTransparency(enabled);
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (process.platform === "darwin") { mainWindow.setVibrancy(enabled ? "under-window" : null); }
        }
        return nextState;
      },
      setTranscriptVerbose: async (_event: unknown, enabled: boolean) => store.setTranscriptVerbose(enabled),
      setComposerDeviceMode: async (_event: unknown, mode: string) => store.setComposerDeviceMode(mode as never),
      setPlanModeIdeology: async (_event: unknown, ideology: string) => store.setPlanModeIdeology(ideology as never),
      setThreadTransition: async (_event: unknown, preferences: unknown) => store.setThreadTransition(preferences as never),

      // -- Composer --
      pickComposerAttachments: async () => {
        const result = await dialog.showOpenDialog({
          properties: ["openFile", "multiSelections"],
          title: "Attach files",
        });
        if (result.canceled || result.filePaths.length === 0) return store.getState();
        const attachments = await Promise.all(result.filePaths.map(readComposerAttachment));
        return store.addComposerAttachments(attachments);
      },
      readClipboardImage: (event: unknown) => {
        (event as { returnValue: unknown }).returnValue = readClipboardImageAttachment();
      },
      addComposerAttachments: (_event: unknown, attachments: unknown) => {
        const validated = (attachments as readonly unknown[]).flatMap((a) => validateComposerAttachmentPayload(a as ComposerAttachment));
        return store.addComposerAttachments(validated as never);
      },
      removeComposerAttachment: (_event: unknown, attachmentId: string) =>
        store.removeComposerAttachment(attachmentId),
      editQueuedComposerMessage: (_event: unknown, messageId: string, currentDraft?: string) =>
        store.editQueuedComposerMessage(messageId, currentDraft),
      cancelQueuedComposerEdit: () => store.cancelQueuedComposerEdit(),
      removeQueuedComposerMessage: (_event: unknown, messageId: string) =>
        store.removeQueuedComposerMessage(messageId),
      steerQueuedComposerMessage: (_event: unknown, messageId: string) =>
        store.steerQueuedComposerMessage(messageId),
      updateComposerDraft: (_event: unknown, composerDraft: string) =>
        store.updateComposerDraft(composerDraft),
      submitComposer: (_event: unknown, text: string, options?: { readonly deliverAs?: "steer" | "followUp"; readonly mode?: ComposerMode }) =>
        store.submitComposer(text, options),

      // -- Git / review --
      getFileDiff: async (_event: unknown, workspaceId: string, filePath: string) => {
        const workspacePath = store.getWorkspacePath(workspaceId);
        if (!workspacePath) return "";
        return getFileDiff(workspacePath, filePath);
      },
      stageFile: async (_event: unknown, workspaceId: string, filePath: string) => {
        const workspacePath = store.getWorkspacePath(workspaceId);
        if (!workspacePath) throw new Error(`Unknown workspace: ${workspaceId}`);
        await stageFile(workspacePath, filePath);
      },
      undoEdits: async (_event: unknown, workspaceId: string, ops: readonly UndoEditOp[]) => {
        const workspacePath = store.getWorkspacePath(workspaceId);
        if (!workspacePath) throw new Error(`Unknown workspace: ${workspaceId}`);
        return undoEdits(workspacePath, ops);
      },
      redoEdits: async (_event: unknown, workspaceId: string, ops: readonly UndoEditOp[]) => {
        const workspacePath = store.getWorkspacePath(workspaceId);
        if (!workspacePath) throw new Error(`Unknown workspace: ${workspaceId}`);
        return redoEdits(workspacePath, ops);
      },
      setCommitPushModel: (_event: unknown, workspaceId: string, model: string) =>
        store.setCommitPushModel(workspaceId, model),
      commitPushExecute: async (_event: unknown, workspaceId: string) => {
        const workspacePath = store.getWorkspacePath(workspaceId);
        if (!workspacePath) {
          console.error(JSON.stringify({ tag: "commit-push", step: "ipc.unknown_workspace", workspaceId }));
          return { success: false, message: `Unknown workspace: ${workspaceId}` };
        }
        const configuredModel = store.state.commitPushModel;
        const modelString = configuredModel ?? "deepseek:deepseek-chat";
        console.error(JSON.stringify({
          tag: "commit-push", step: "ipc.invoke", workspaceId, workspacePath,
          configuredModel, effectiveModel: modelString, usingDefault: !configuredModel,
        }));
        const getApiKey = (providerId: string) => store.getProviderApiKey(providerId);
        return executeCommitPush(workspacePath, modelString, getApiKey);
      },
      getWorkspacePrInfo: async (_event: unknown, workspaceId: string) => {
        const workspacePath = store.getWorkspacePath(workspaceId);
        if (!workspacePath) throw new Error(`Unknown workspace: ${workspaceId}`);
        return getWorkspacePrInfo(workspacePath);
      },
      generatePrDraft: async (_event: unknown, workspaceId: string, baseBranch?: string) => {
        const workspacePath = store.getWorkspacePath(workspaceId);
        if (!workspacePath) throw new Error(`Unknown workspace: ${workspaceId}`);
        const modelString = store.state.commitPushModel ?? "deepseek:deepseek-chat";
        const getApiKey = (providerId: string) => store.getProviderApiKey(providerId);
        return generatePrDraft(workspacePath, modelString, baseBranch, getApiKey);
      },
      prCreate: async (_event: unknown, workspaceId: string, input: { title: string; body: string; base: string; draft: boolean }) => {
        const workspacePath = store.getWorkspacePath(workspaceId);
        if (!workspacePath) return { success: false, message: `Unknown workspace: ${workspaceId}` };
        return createPullRequest(workspacePath, input);
      },

      // -- Chat --
      startChat: async (_event: unknown, input: StartChatInput) => store.startChat(input),
      selectChat: async (_event: unknown, chatId: string) => store.selectChat(chatId),
      archiveChat: async (_event: unknown, chatId: string) => store.archiveChat(chatId),
      unarchiveChat: async (_event: unknown, chatId: string) => store.unarchiveChat(chatId),
      removeChat: async (_event: unknown, chatId: string) => store.removeChat(chatId),
      renameChat: async (_event: unknown, chatId: string, title: string) => store.renameChat(chatId, title),
      getChatAgentsMd: async (_event: unknown, chatId: string) => store.getChatAgentsMd(chatId),
      writeChatAgentsMd: async (_event: unknown, chatId: string, content: string) => {
        await store.writeChatAgentsMd(chatId, content);
      },

      // -- Context snapshot --
      getContextSnapshot: async (_event: unknown, workspaceId: string, sessionId?: string) => {
        const workspacePath = store.getWorkspacePath(workspaceId);
        if (!workspacePath) {
          return buildContextSnapshot({ workspaceId, workspacePath: "" });
        }
        const runtime = store.runtimeByWorkspace.get(workspaceId);
        const contextFiles = await readContextFiles(workspacePath);
        const state = await store.getState();
        const sessionCommands = sessionId
          ? (state.sessionCommandsBySession[`${workspaceId}:${sessionId}`] ?? [])
          : [];
        const workspace = state.workspaces.find((w) => w.id === workspaceId || w.rootWorkspaceId === workspaceId);
        const session = sessionId ? workspace?.sessions.find((s) => s.id === sessionId) : undefined;
        return buildContextSnapshot({
          workspaceId,
          workspacePath,
          sessionId,
          ...contextFiles,
          runtime,
          sessionCommands: sessionCommands.map((c) => ({ name: c.name, source: c.source })),
          sessionProvider: session?.config?.provider,
          sessionModelId: session?.config?.modelId,
          sessionThinkingLevel: session?.config?.thinkingLevel,
        });
      },
    },
  };

  registerMainHandlers(mainHandlers as MainHandlerAdapters);

  mainWindow = createWindow();
  notificationManager.trackWindow(mainWindow);
  notificationPermissionService.trackWindow(mainWindow);
  themeManager.setWindow(mainWindow);
  attachStatePublisher(mainWindow);
  attachViewedSessionTracking(mainWindow);
  void notificationPermissionService.getCurrentStatus();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      notificationManager?.trackWindow(mainWindow);
      notificationPermissionService?.trackWindow(mainWindow);
      themeManager.setWindow(mainWindow);
      attachStatePublisher(mainWindow);
      attachViewedSessionTracking(mainWindow);
      void notificationPermissionService?.getCurrentStatus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopNotifications?.();
    stopNotifications = undefined;
    notificationManager = undefined;
    notificationPermissionService?.dispose();
    notificationPermissionService = undefined;
    stopPeriodicChecks?.();
    stopPeriodicChecks = undefined;
    stopPruningTerminals?.();
    stopPruningTerminals = undefined;
    terminalService?.dispose();
    terminalService = undefined;
    app.quit();
  }
});

app.on("before-quit", (event) => {
  stopNotifications?.();
  stopNotifications = undefined;
  notificationManager = undefined;
  notificationPermissionService?.dispose();
  notificationPermissionService = undefined;
  stopPeriodicChecks?.();
  stopPeriodicChecks = undefined;
  stopPruningTerminals?.();
  stopPruningTerminals = undefined;
  terminalService?.dispose();
  terminalService = undefined;
  if (quittingAfterStoreFlush || !store) {
    return;
  }

  event.preventDefault();
  quittingAfterStoreFlush = true;
  void store
    .flushPersistence()
    .catch(() => undefined)
    .finally(() => {
      quitAndInstall();
      app.quit();
    });
});

function resolveInitialWorkspacePaths(): readonly string[] {
  const raw = process.env.PI_APP_INITIAL_WORKSPACES;
  if (raw !== undefined) {
    return raw
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

async function readComposerAttachment(filePath: string): Promise<ComposerAttachment> {
  const mimeType = mimeTypeForPath(filePath);
  if (mimeType.startsWith("image/")) {
    return readComposerImageAttachment(filePath, mimeType);
  }

  const stats = await stat(filePath);
  return {
    id: randomUUID(),
    kind: "file",
    name: path.basename(filePath),
    mimeType,
    fsPath: filePath,
    ...(typeof stats.size === "number" ? { sizeBytes: stats.size } : {}),
  };
}

async function readComposerImageAttachment(filePath: string, mimeType: string): Promise<ComposerImageAttachment> {
  const buffer = await readFile(filePath);
  return {
    id: randomUUID(),
    kind: "image",
    name: path.basename(filePath),
    mimeType,
    data: buffer.toString("base64"),
  };
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const supported = SUPPORTED_IMAGE_TYPES.find((type) => type.extension === extension);
  if (supported) {
    return supported.mimeType;
  }
  return "application/octet-stream";
}

function validateComposerAttachmentPayload(attachment: ComposerAttachment): ComposerAttachment[] {
  if (attachment.kind === "image") {
    if (typeof attachment.data !== "string" || typeof attachment.mimeType !== "string" || !SUPPORTED_IMAGE_MIME_TYPES.has(attachment.mimeType)) {
      return [];
    }
    return [
      {
        ...attachment,
        kind: "image",
      },
    ];
  }

  if (
    attachment.kind !== "file" ||
    typeof attachment.fsPath !== "string" ||
    typeof attachment.mimeType !== "string" ||
    typeof attachment.name !== "string"
  ) {
    return [];
  }

  const normalized: ComposerFileAttachment = {
    ...attachment,
    kind: "file",
    fsPath: attachment.fsPath.trim(),
    name: attachment.name.trim() || path.basename(attachment.fsPath),
  };
  if (!normalized.fsPath) {
    return [];
  }
  return [normalized];
}

function createRuntimeLoginCallbacks() {
  return {
    onAuth: async ({ url, instructions: _instructions }: { readonly url: string; readonly instructions?: string }) => {
      await shell.openExternal(url);
    },
    onPrompt: async ({ message, placeholder }: { readonly message: string; readonly placeholder?: string }) =>
      promptForText(message, placeholder),
  };
}

const CAVEMAN_LEVELS: readonly CavemanLevel[] = ["off", "lite", "full", "ultra", "wenyan-lite", "wenyan", "wenyan-ultra", "micro"];
const CAVEMAN_CONFIG_PATH = path.join(homedir(), ".pi", "agent", "caveman.json");
const DEFAULT_CAVEMAN_CONFIG: CavemanConfigSnapshot = { defaultLevel: "full", showStatus: true };

function normalizeCavemanLevel(value: unknown): CavemanLevel {
  return CAVEMAN_LEVELS.includes(value as CavemanLevel) ? (value as CavemanLevel) : DEFAULT_CAVEMAN_CONFIG.defaultLevel;
}

async function readCavemanConfig(): Promise<CavemanConfigSnapshot> {
  try {
    const parsed = JSON.parse(await readFile(CAVEMAN_CONFIG_PATH, "utf8")) as Partial<CavemanConfigSnapshot>;
    return {
      defaultLevel: normalizeCavemanLevel(parsed.defaultLevel),
      showStatus: typeof parsed.showStatus === "boolean" ? parsed.showStatus : DEFAULT_CAVEMAN_CONFIG.showStatus,
    };
  } catch {
    return DEFAULT_CAVEMAN_CONFIG;
  }
}

async function writeCavemanConfig(config: CavemanConfigSnapshot): Promise<void> {
  await mkdir(path.dirname(CAVEMAN_CONFIG_PATH), { recursive: true });
  await writeFile(CAVEMAN_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function promptForText(message: string, placeholder = ""): Promise<string> {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    throw new Error("Main window is not available for login.");
  }
  window.show();
  window.focus();
  const result = await window.webContents.executeJavaScript(
    `window.prompt(${JSON.stringify(message)}, ${JSON.stringify(placeholder)})`,
    true,
  );
  if (typeof result !== "string" || result.trim().length === 0) {
    throw new Error("Login cancelled.");
  }
  return result.trim();
}
