import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  nativeImage,
  screen,
  shell,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
} from "electron";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { AutomationStore } from "./automation-store.ts";
import { AutomationScheduler } from "./automation-scheduler.ts";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Track graphify watch processes by workspace ID
const graphifyWatchProcesses = new Map<string, number>();
import { pathToFileURL } from "node:url";
import { DesktopAppStore } from "./app-store";
import { getChangedFiles, getFileDiff, getWorkspaceGitInfo, redoEdits, stageFile, undoEdits } from "./workspace-review";
import { configureCommitPushLogDir, executeCommitPush } from "./commit-push-service";
import {
  configurePrLogDir,
  createPullRequest,
  generatePrDraft,
  getWorkspacePrInfo,
} from "./pr-service";
import { listWorkspaceFiles } from "./workspace-review";
import { MAIN_DEV_RELOAD_MARKER } from "./dev-reload-main-probe";
import { importLoginShellEnv } from "./login-shell-env";
import { NotificationManager } from "./notification-manager";
import {
  NotificationPermissionService,
} from "./notification-permission";
import { checkForUpdate, downloadUpdate, initAutoUpdater, onUpdateStateChange, quitAndInstall, startPeriodicChecks } from "./update-checker";
import { ThemeManager } from "./theme-manager";
import { TerminalService } from "./terminal-service";
import type { DesktopAppState, ThemeMode } from "../src/desktop-state";
import { buildContextSnapshot, readContextFiles } from "./context-snapshot";
import type { ComposerMode } from "../src/composer-mode";
import { desktopIpc, getDesktopCommandFromShortcut, type CavemanConfigSnapshot, type CavemanLevel, type GraphifyCommunitySummary, type GraphifyProjectMapStatus, type GraphifyRunResult, type UndoEditOp } from "../src/ipc";
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
import { ZOOM_BASELINE, ZOOM_FACTOR_LADDER } from "../src/desktop-state";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import type { GenerateThreadTitleOptions } from "@pi-gui/pi-sdk-driver";
import type { WorkspaceRef } from "@pi-gui/session-driver";
import { buildHandoffPayload, summarizeTranscript } from "./handoff-core";
import type { BuildHandoffPayloadInput, CreateSeededSessionInput } from "./handoff-core";
import { OverlayWindowManager, type OverlayBrowserWindow } from "./overlay-window-manager";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const windowTestMode = resolveWindowTestMode();
const devReloadMarkersEnabled = process.env.PI_APP_DEV_RELOAD_MARKERS === "1";
let store: DesktopAppStore;
const themeManager = new ThemeManager();
let mainWindow: BrowserWindow | null = null;
let overlayManager: OverlayWindowManager | undefined;
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

const GRAPHIFY_REPORT_PREVIEW_CHARS = 12000;
const GRAPHIFY_COMMUNITY_LIMIT = 48;

async function getGraphifyProjectMapStatusForWorkspace(workspaceId: string, workspacePath: string): Promise<GraphifyProjectMapStatus> {
  if (!workspacePath) {
    return { workspaceId, workspacePath, available: false, stale: false, communities: [], error: "Unknown workspace" };
  }

  const graphPath = path.join(workspacePath, "graphify-out", "graph.json");
  const reportPath = path.join(workspacePath, "graphify-out", "GRAPH_REPORT.md");
  const htmlPath = path.join(workspacePath, "graphify-out", "graph.html");

  try {
    const graphRaw = await readFile(graphPath, "utf8");
    const graph = JSON.parse(graphRaw) as {
      nodes?: readonly unknown[];
      edges?: readonly unknown[];
      links?: readonly unknown[];
      communities?: readonly unknown[] | Record<string, unknown>;
      built_at_commit?: string;
      metadata?: { built_from_commit?: string; commit?: string };
    };
    const reportPreview = await readFile(reportPath, "utf8").then((text) => text.slice(0, GRAPHIFY_REPORT_PREVIEW_CHARS)).catch(() => undefined);
    const htmlAvailable = await stat(htmlPath).then(() => true).catch(() => false);
    const builtCommit = extractBuiltCommit(reportPreview) ?? graph.built_at_commit ?? graph.metadata?.built_from_commit ?? graph.metadata?.commit;
    const communityCountFromReport = reportPreview?.match(/(\d+) communities/)?.[1];
    const currentCommit = await readGitCommit(workspacePath);
    // Check if hook is installed by looking for the hook file directly (avoids PATH issues in Electron)
    let hookInstalled = false;
    try {
      const hookFile = await readFile(path.join(workspacePath, ".git", "hooks", "post-commit"), "utf8");
      hookInstalled = hookFile.includes("graphify-hook-start");
    } catch {
      // no hook file
    }
    const commitsDiffer = Boolean(builtCommit && currentCommit && !currentCommit.startsWith(builtCommit) && builtCommit !== currentCommit);
    return {
      workspaceId,
      workspacePath,
      available: true,
      stale: commitsDiffer && !hookInstalled,
      graphPath,
      reportPath,
      htmlPath: htmlAvailable ? htmlPath : undefined,
      builtCommit,
      currentCommit,
      nodeCount: graph.nodes?.length,
      edgeCount: graph.edges?.length ?? graph.links?.length,
      communityCount: communityCountFromReport ? Number(communityCountFromReport) : countGraphifyCommunities(graph),
      communities: extractGraphifyCommunities(reportPreview),
      reportPreview,
    };
  } catch (error) {
    return {
      workspaceId,
      workspacePath,
      available: false,
      stale: false,
      graphPath,
      reportPath,
      htmlPath,
      communities: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function countGraphifyCommunities(graph: { communities?: readonly unknown[] | Record<string, unknown> }): number | undefined {
  if (Array.isArray(graph.communities)) return graph.communities.length;
  if (typeof graph.communities === "object" && graph.communities) return Object.keys(graph.communities).length;
  return undefined;
}

function extractBuiltCommit(report?: string): string | undefined {
  return report?.match(/Built from commit:\s*`?([a-f0-9]{7,40})`?/i)?.[1];
}

function extractGraphifyCommunities(report?: string): readonly GraphifyCommunitySummary[] {
  if (!report) return [];
  const communities: GraphifyCommunitySummary[] = [];
  const lines = report.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^- \[\[_COMMUNITY_([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (match?.[1]) {
      communities.push({ name: (match[2] || match[1]).trim() });
    }
    if (communities.length >= GRAPHIFY_COMMUNITY_LIMIT) break;
  }
  return communities;
}

async function readGitCommit(workspacePath: string): Promise<string | undefined> {
  return execFileText("git", ["rev-parse", "HEAD"], workspacePath)
    .then((output) => output.trim() || undefined)
    .catch(() => undefined);
}

async function runGraphify(workspaceId: string, workspacePath: string, args: readonly string[]): Promise<GraphifyRunResult> {
  if (!workspacePath) return { success: false, message: "Unknown workspace" };
  try {
    const output = await execFileText("graphify", [...args], workspacePath, 10 * 60 * 1000);
    return {
      success: true,
      message: output.trim() || `graphify ${args.join(" ")} completed`,
      status: await getGraphifyProjectMapStatusForWorkspace(workspaceId, workspacePath),
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      status: await getGraphifyProjectMapStatusForWorkspace(workspaceId, workspacePath),
    };
  }
}

async function buildGraphify(workspaceId: string, workspacePath: string): Promise<GraphifyRunResult> {
  if (!workspacePath) return { success: false, message: "Unknown workspace" };
  const outputs: string[] = [];
  try {
    outputs.push(await execFileText("graphify", ["extract", "."], workspacePath, 10 * 60 * 1000));
    outputs.push(await execFileText("graphify", ["cluster-only", "."], workspacePath, 10 * 60 * 1000));
    return {
      success: true,
      message: outputs.join("\n").trim() || "Graphify build completed",
      status: await getGraphifyProjectMapStatusForWorkspace(workspaceId, workspacePath),
    };
  } catch (error) {
    return {
      success: false,
      message: `${outputs.join("\n")}\n${error instanceof Error ? error.message : String(error)}`.trim(),
      status: await getGraphifyProjectMapStatusForWorkspace(workspaceId, workspacePath),
    };
  }
}

function execFileText(command: string, args: readonly string[], cwd: string, timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { cwd, timeout, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      const output = `${stdout || ""}${stderr || ""}`;
      if (error) {
        reject(new Error(output.trim() || error.message));
        return;
      }
      resolve(output);
    });
  });
}

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
  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    transparent: false,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f3f4f8",
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
  // Re-apply the persisted zoom after every content load (initial + dev HMR
  // reloads, which otherwise reset Chromium zoom to 1.0).
  window.webContents.on("did-finish-load", () => {
    window.webContents.setZoomFactor(store?.state.zoomFactor ?? ZOOM_BASELINE);
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

function resolveOverlayUrl(): string {
  if (isDev) {
    return `${process.env.ELECTRON_RENDERER_URL as string}#overlay`;
  }
  const indexPath = path.join(__dirname, "..", "renderer", "index.html");
  return `${pathToFileURL(indexPath).toString()}#overlay`;
}

function createOverlayWindowManager(): OverlayWindowManager {
  return new OverlayWindowManager({
    createWindow: (options) => new BrowserWindow(options) as unknown as OverlayBrowserWindow,
    getWorkArea: () => screen.getPrimaryDisplay().workArea,
    preloadPath: path.join(__dirname, "..", "preload", "preload.js"),
    resolveOverlayUrl,
    subscribeToState: (listener) => store.subscribe(listener),
    getState: () => store.getState(),
  });
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
  store.setLiveEditStatsListener((stats) => {
    if (canPublishToWindow(window)) {
      window.webContents.send(desktopIpc.liveEditStats, stats);
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
    store.setLiveEditStatsListener(undefined);
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
    store.setLiveEditStatsListener(undefined);
    if (mainWindow === window) {
      mainWindow = null;
      overlayManager?.close();
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

/**
 * Step the window zoom along the discrete ladder (or reset to baseline) and
 * persist it. Zoom must be applied in the main process because the renderer is
 * sandboxed and cannot reach webFrame. The new factor flows back to the
 * renderer via the normal state snapshot, which drives the % HUD and the
 * zoom-compensated chrome offsets.
 */
function stepZoom(direction: "in" | "out" | "reset"): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getFocusedWindow();
  if (!window || window.isDestroyed()) {
    return;
  }
  const current = store?.state.zoomFactor ?? ZOOM_BASELINE;
  let next: number;
  if (direction === "reset") {
    next = ZOOM_BASELINE;
  } else {
    let nearestIndex = 0;
    let bestDistance = Infinity;
    ZOOM_FACTOR_LADDER.forEach((factor, index) => {
      const distance = Math.abs(factor - current);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearestIndex = index;
      }
    });
    const target = direction === "in" ? nearestIndex + 1 : nearestIndex - 1;
    const clamped = Math.max(0, Math.min(ZOOM_FACTOR_LADDER.length - 1, target));
    next = ZOOM_FACTOR_LADDER[clamped] ?? ZOOM_BASELINE;
    if (next === current) {
      return;
    }
  }
  window.webContents.setZoomFactor(next);
  void store?.setZoomFactor(next);
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
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { label: "Actual Size", accelerator: "CommandOrControl+0", click: () => stepZoom("reset") },
        { label: "Zoom In", accelerator: "CommandOrControl+Plus", click: () => stepZoom("in") },
        { label: "Zoom Out", accelerator: "CommandOrControl+-", click: () => stepZoom("out") },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Recover the user's login-shell environment first. GUI launches (Finder/Dock)
// start with a minimal env, so profile-managed PATH entries and tool/secret
// exports the pi runtime shells out to (e.g. `!`-prefixed provider headers)
// would otherwise be missing. No-op for terminal launches.
importLoginShellEnv();

// Ensure npm (and other Homebrew/npm-global binaries) plus pi's own managed
// bin dir are available even when login-shell import is skipped or fails.
const extraBinPaths = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  `${process.env.HOME}/.npm-global/bin`,
  path.join(homedir(), ".pi", "agent", "bin"),
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

const hasSingleInstanceLock = isDev || app.requestSingleInstanceLock();
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
  const automationStore = new AutomationStore(configuredUserDataDir);
  await automationStore.load();
  store.automationStoreRef = automationStore;
  await store.initialize();
  // Inject automations into the initial state (initializeInternal doesn't call refreshState)
  store.state = { ...store.state, automations: automationStore.getAll() };
  const automationScheduler = new AutomationScheduler({
    store: automationStore,
    startAutomationThread: (automation) =>
      store.startAutomationThread({
        rootWorkspaceId: automation.workspaceId,
        environment: automation.environment,
        prompt: automation.prompt,
        name: automation.name,
        provider: automation.model?.provider,
        modelId: automation.model?.modelId,
        thinkingLevel: automation.thinkingLevel,
      }),
    onAutomationFired: (_automation, _sessionId) => {
      // Session is already created by the scheduler; store refresh happens via onStateChanged.
    },
    onStateChanged: () => void store.refreshState(),
  });
  automationScheduler.start();

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
      openOverlay: () => {
        overlayManager ??= createOverlayWindowManager();
        overlayManager.open();
      },
      closeOverlay: () => {
        overlayManager?.close();
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
      showFileInFolder: async (_event: unknown, workspaceId: string, filePath: string) => {
        const workspacePath = store.getWorkspacePath(workspaceId);
        if (!workspacePath) throw new Error(`Unknown workspace: ${workspaceId}`);
        const absolute = path.isAbsolute(filePath) ? filePath : path.join(workspacePath, filePath);
        shell.showItemInFolder(absolute);
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
        const next: CavemanConfigSnapshot = { defaultLevel: normalizeCavemanLevel(level), enabled: true };
        await writeCavemanConfig(next);
        return next;
      },
      setCavemanOnLevel: async (_event: unknown, level: CavemanLevel) => {
        const current = await readCavemanConfig();
        const next: CavemanConfigSnapshot = { ...current, enabled: level !== "off", defaultLevel: level === "off" ? current.defaultLevel : normalizeCavemanLevel(level) };
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
      setTranscriptVerbose: async (_event: unknown, enabled: boolean) => store.setTranscriptVerbose(enabled),
      setComposerDeviceMode: async (_event: unknown, mode: string) => store.setComposerDeviceMode(mode as never),
      setStreamReveal: async (_event: unknown, mode: string) => store.setStreamReveal(mode as never),
      setStreamRevealSpeed: async (_event: unknown, speed: string) => store.setStreamRevealSpeed(speed as never),
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
      submitComposer: (_event: unknown, text: string, options?: { readonly deliverAs?: "steer" | "followUp"; readonly mode?: ComposerMode; readonly isFirstPlanPrompt?: boolean }) =>
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
      getSmartCompactSettings: () => store.getSmartCompactSettings(),
      setSmartCompactSettings: (_event: unknown, settings: Record<string, unknown>) =>
        store.setSmartCompactSettings(settings),
      analyzeExtensionConfig: async (_event: unknown, extensionPath: string, model?: string) =>
        store.analyzeExtensionConfig(extensionPath, model),
      getExtensionConfig: async (_event: unknown, extensionPath: string) =>
        store.getExtensionConfig(extensionPath),
      setExtensionConfig: async (_event: unknown, extensionPath: string, values: readonly { key: string; value: string | number | boolean }[]) =>
        store.setExtensionConfig(extensionPath, values),
      installExtension: async (_event: unknown, source: string, local?: boolean) =>
        store.installExtension(source, local),
      uninstallExtension: async (_event: unknown, source: string, local?: boolean) =>
        store.uninstallExtension(source, local),
      checkExtensionUpdates: async () =>
        store.checkExtensionUpdates(),
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

      // -- Handoff / Advisor --
      buildHandoffPayload: async (_event: unknown, input: { workspaceId: string; sessionId: string; scope: string; quotedText?: string; userNote?: string; framing?: string }) => {
        const sessionRef = { workspaceId: input.workspaceId, sessionId: input.sessionId };
        const transcript = await store.getSessionTranscript(sessionRef);
        const settings = await store.getSmartCompactSettings();
        const getSummary = (tx: readonly import("../src/desktop-state").TranscriptMessage[]) =>
          summarizeTranscript(tx, { summaryModel: settings.summaryModel as string | undefined });
        return buildHandoffPayload(transcript, { ...input, sessionRef } as BuildHandoffPayloadInput, getSummary);
      },
      createSeededSession: async (_event: unknown, input: CreateSeededSessionInput) => {
        const result = await store.createSeededSession(input);
        return result;
      },
      getSessionTranscript: async (_event: unknown, workspaceId: string, sessionId: string) => {
        return store.getSessionTranscript({ workspaceId, sessionId });
      },
      getSubagentSessionEntries: async (_event: unknown, sessionFilePath: string) => {
        return store.getSubagentSessionEntries(sessionFilePath);
      },
      searchTranscriptText: async (_event: unknown, sessionKeys: readonly string[], query: string) => {
        return store.searchTranscripts(sessionKeys, query);
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
      getGraphifyProjectMapStatus: async (_event: unknown, workspaceId: string) => {
        return getGraphifyProjectMapStatusForWorkspace(workspaceId, store.getWorkspacePath(workspaceId) ?? "");
      },
      updateGraphifyProjectMap: async (_event: unknown, workspaceId: string) => {
        return runGraphify(workspaceId, store.getWorkspacePath(workspaceId) ?? "", ["update", "."]);
      },
      buildGraphifyProjectMap: async (_event: unknown, workspaceId: string) => {
        return buildGraphify(workspaceId, store.getWorkspacePath(workspaceId) ?? "");
      },
      getGraphifyHealthCheck: async (_event: unknown, workspaceId: string) => {
        const workspacePath = store.getWorkspacePath(workspaceId) ?? "";
        const issues: Array<{ severity: "error" | "warning"; code: string; message: string; fixHint?: string }> = [];

        // Check 1: graphify binary
        const binOk = await new Promise<boolean>((resolve) => {
          execFile("graphify", ["--version"], { timeout: 10_000 }, (err) => resolve(!err));
        });
        if (!binOk) {
          issues.push({
            severity: "error",
            code: "missing-binary",
            message: "`graphify` CLI not found or not runnable.",
            fixHint: "Install with: uv tool install graphifyy (or: pip install graphifyy)",
          });
        }

        // Check 2: graph.json exists and is valid
        const graphPath = path.resolve(workspacePath, "graphify-out", "graph.json");
        let graphValid = false;
        let nodeCount = 0;
        try {
          const raw = await readFile(graphPath, "utf8");
          const parsed = JSON.parse(raw);
          nodeCount = Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
          graphValid = nodeCount > 0;
        } catch {
          // missing or corrupt
        }
        if (!graphValid) {
          issues.push({
            severity: "error",
            code: "missing-graph",
            message: "graphify-out/graph.json is missing, empty, or corrupt.",
            fixHint: "Build with: graphify extract . (or click Build in the Project map popover)",
          });
        }

        // Check 3: freshness
        const reportPath = path.resolve(workspacePath, "graphify-out", "GRAPH_REPORT.md");
        let builtCommit: string | undefined;
        try {
          const report = await readFile(reportPath, "utf8");
          builtCommit = report.match(/Built from commit:\s*`?([a-f0-9]{7,40})`?/i)?.[1];
        } catch {
          // no report
        }

        let currentCommit: string | undefined;
        try {
          currentCommit = await new Promise<string | undefined>((resolve) => {
            execFile("git", ["rev-parse", "--short", "HEAD"], { cwd: workspacePath, timeout: 5_000 }, (err, stdout) => {
              resolve(err ? undefined : stdout.trim());
            });
          });
        } catch {
          // not a git repo
        }

        if (graphValid && builtCommit && currentCommit && builtCommit !== currentCommit) {
          // Check if hook is installed by looking for the hook file directly (avoids PATH issues in Electron)
          let hookInstalled = false;
          try {
            const hookFile = await readFile(path.resolve(workspacePath, ".git", "hooks", "post-commit"), "utf8");
            hookInstalled = hookFile.includes("graphify-hook-start");
          } catch {
            // no hook file
          }
          if (!hookInstalled) {
            issues.push({
              severity: "warning",
              code: "stale-graph",
              message: `Graph was built from commit ${builtCommit}, but current HEAD is ${currentCommit}. Results may be outdated.`,
              fixHint: "Update with: graphify update . (or click Update in the Project map popover)",
            });
          }
        }

        // Build debug prompt
        const debugPrompt = issues.length > 0
          ? [
              "I'm having issues with Graphify in this workspace:",
              "",
              ...issues.map((i) => `- [${i.severity.toUpperCase()}] ${i.message}${i.fixHint ? ` Fix: ${i.fixHint}` : ""}`),
              "",
              "Please diagnose and fix these issues. The workspace is at: " + workspacePath,
            ].join("\n")
          : undefined;

        return { healthy: issues.length === 0, issues, debugPrompt };
      },
      getGraphifyHookStatus: async (_event: unknown, workspaceId: string) => {
        const workspacePath = store.getWorkspacePath(workspaceId) ?? "";
        return new Promise((resolve) => {
          execFile("graphify", ["hook", "status"], { cwd: workspacePath, timeout: 10_000 }, (_err, stdout) => {
            const text = stdout ?? "";
            resolve({
              postCommit: text.includes("post-commit: installed"),
              postCheckout: text.includes("post-checkout: installed"),
            });
          });
        });
      },
      setGraphifyHook: async (_event: unknown, workspaceId: string, enable: boolean) => {
        const workspacePath = store.getWorkspacePath(workspaceId) ?? "";
        return new Promise((resolve) => {
          execFile("graphify", ["hook", enable ? "install" : "uninstall"], { cwd: workspacePath, timeout: 15_000 }, (err, stdout, stderr) => {
            resolve({ success: !err, message: err ? (stderr || stdout || String(err)) : (stdout || "Done") });
          });
        });
      },
      getGraphifyWatchStatus: async (_event: unknown, workspaceId: string) => {
        const pid = graphifyWatchProcesses.get(workspaceId);
        if (!pid) return { running: false };
        // Check if process is still alive
        const alive = await new Promise<boolean>((resolve) => {
          try {
            process.kill(pid, 0);
            resolve(true);
          } catch {
            resolve(false);
          }
        });
        if (!alive) {
          graphifyWatchProcesses.delete(workspaceId);
          return { running: false };
        }
        return { running: true, pid };
      },
      setGraphifyWatch: async (_event: unknown, workspaceId: string, enable: boolean) => {
        const workspacePath = store.getWorkspacePath(workspaceId) ?? "";
        // Stop existing watcher if running
        const existingPid = graphifyWatchProcesses.get(workspaceId);
        if (existingPid) {
          try { process.kill(existingPid, "SIGTERM"); } catch { /* already dead */ }
          graphifyWatchProcesses.delete(workspaceId);
        }
        if (!enable) return { success: true, message: "Watcher stopped." };
        // Start new watcher — capture stderr to detect early failures
        const child = spawn("graphify", ["watch", "."], { cwd: workspacePath, stdio: ["ignore", "pipe", "pipe"], detached: true });
        child.unref();
        if (!child.pid) return { success: false, message: "Failed to spawn watcher." };
        // Wait briefly to see if it dies immediately (e.g. missing watchdog)
        const earlyExit = await new Promise<string | null>((resolve) => {
          let stderr = "";
          child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
          child.on("exit", (_code, signal) => {
            if (signal === "SIGTERM") return resolve(null); // intentional stop
            resolve(stderr || "Watcher exited unexpectedly.");
          });
          // If still alive after 2s, consider it started successfully
          setTimeout(() => resolve(null), 2000);
        });
        if (earlyExit) {
          graphifyWatchProcesses.delete(workspaceId);
          return { success: false, message: earlyExit };
        }
        graphifyWatchProcesses.set(workspaceId, child.pid);
        child.on("exit", () => graphifyWatchProcesses.delete(workspaceId));
        return { success: true, message: `Watcher started (PID ${child.pid}).` };
      },

      readGraphifyGraph: async (_event: unknown, workspaceId: string) => {
        const workspacePath = store.getWorkspacePath(workspaceId) ?? "";
        if (!workspacePath) return { error: "Unknown workspace" };
        const graphPath = path.join(workspacePath, "graphify-out", "graph.json");
        try {
          const raw = await readFile(graphPath, "utf8");
          return JSON.parse(raw);
        } catch {
          return { error: "graph.json not found or invalid" };
        }
      },

      // -- Automation --
      automationCreate: async (_event: unknown, input: { name?: string; prompt: string; schedule: import("../src/desktop-state.ts").AutomationSchedule; workspaceId: string; environment?: import("../src/desktop-state.ts").NewThreadEnvironment; model?: { provider: string; modelId: string }; thinkingLevel?: string; enabled?: boolean }) => {
        await automationStore.create(input);
        // Write back into the store's canonical state so later emit() pushes
        // (from session events etc.) don't clobber the renderer with a stale
        // automations list. getState() then returns the fresh value.
        store.state = { ...store.state, automations: automationStore.getAll() };
        return store.getState();
      },
      automationUpdate: async (_event: unknown, id: string, patch: Record<string, unknown>) => {
        await automationStore.update(id, patch as never);
        store.state = { ...store.state, automations: automationStore.getAll() };
        return store.getState();
      },
      automationDelete: async (_event: unknown, id: string) => {
        await automationStore.delete(id);
        store.state = { ...store.state, automations: automationStore.getAll() };
        return store.getState();
      },
      automationList: async () => {
        store.state = { ...store.state, automations: automationStore.getAll() };
        return store.getState();
      },
      automationFireNow: async (_event: unknown, id: string) => {
        await automationScheduler.fireNow(id);
        store.state = { ...store.state, automations: automationStore.getAll() };
        return store.getState();
      },

      // -- GitHub issue runner --
      listGhMilestones: async (_event: unknown, workspaceId?: string) => store.listGhMilestones(workspaceId),
      runGhMilestone: async (_event: unknown, workspaceId: string, milestoneNumber: number) => store.runGhMilestone(workspaceId, milestoneNumber),
      cancelGhRun: async () => store.cancelGhRun(),

      // -- Update --
      triggerCheckForUpdate: async () => {
        const result = await checkForUpdate();
        return result;
      },
      triggerDownloadUpdate: async () => {
        await downloadUpdate();
      },
      triggerRestartToInstall: async () => {
        quitAndInstall();
      },
    },
  };

  registerMainHandlers(mainHandlers as MainHandlerAdapters);

  mainWindow = createWindow();
  notificationManager.trackWindow(mainWindow);
  notificationPermissionService.trackWindow(mainWindow);
  themeManager.setWindow(mainWindow);
  attachStatePublisher(mainWindow);

  // Push update state to renderer whenever it changes.
  onUpdateStateChange((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(desktopIpc.updateStateChanged, state);
    }
  });
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
  // Kill all graphify watch processes
  for (const [wsId, pid] of graphifyWatchProcesses) {
    try { process.kill(pid, "SIGTERM"); } catch { /* already dead */ }
    graphifyWatchProcesses.delete(wsId);
  }
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
    onDeviceCode: ({ userCode, verificationUri }: { readonly userCode: string; readonly verificationUri: string }) => {
      void shell.openExternal(verificationUri);
      console.log(`[auth] Device code: ${userCode} — visit ${verificationUri}`);
    },
    onPrompt: async ({ message, placeholder }: { readonly message: string; readonly placeholder?: string }) =>
      promptForText(message, placeholder),
    onSelect: async ({ message, options }: { readonly message: string; readonly options: readonly { readonly id: string; readonly label: string }[] }) => {
      console.log(`[auth] ${message}`);
      for (const opt of options) console.log(`  - ${opt.id}: ${opt.label}`);
      return options[0]?.id;
    },
  };
}

const CAVEMAN_LEVELS: readonly CavemanLevel[] = ["off", "lite", "full", "ultra"];
const CAVEMAN_STATE_PATH = path.join(homedir(), ".pi", "agent", "caveman", "state.json");
const DEFAULT_CAVEMAN_CONFIG: CavemanConfigSnapshot = { defaultLevel: "full", enabled: true };

function normalizeCavemanLevel(value: unknown): CavemanLevel {
  return CAVEMAN_LEVELS.includes(value as CavemanLevel) ? (value as CavemanLevel) : DEFAULT_CAVEMAN_CONFIG.defaultLevel;
}

async function readCavemanConfig(): Promise<CavemanConfigSnapshot> {
  try {
    const parsed = JSON.parse(await readFile(CAVEMAN_STATE_PATH, "utf8")) as { enabled?: boolean; level?: string };
    return {
      defaultLevel: normalizeCavemanLevel(parsed.level),
      enabled: parsed.enabled !== false,
    };
  } catch {
    return DEFAULT_CAVEMAN_CONFIG;
  }
}

async function writeCavemanConfig(config: CavemanConfigSnapshot): Promise<void> {
  await mkdir(path.dirname(CAVEMAN_STATE_PATH), { recursive: true });
  const state = { enabled: config.enabled, level: config.defaultLevel };
  await writeFile(CAVEMAN_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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
