/**
 * Overlay window lifecycle — owns the single always-on-top overlay BrowserWindow.
 *
 * The overlay is a second Electron window that floats above everything,
 * is transparent and frameless, and sits at the bottom-centre of the primary
 * display. Only one overlay exists at a time; a second `open()` focuses the
 * existing one. The overlay shares the main window's preload script and
 * receives `DesktopAppState` snapshots via the same state-change channel.
 *
 * This module keeps all Electron access behind injected dependencies so the
 * geometry, window config, single-instance, and lifecycle behaviour can be
 * exercised under plain `node --test` with fakes.
 */

import type { DesktopAppState } from "../src/desktop-state";
import { desktopIpc } from "../src/ipc.ts";

export interface OverlayRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OverlaySize {
  readonly width: number;
  readonly height: number;
}

/** Default overlay dimensions (logical pixels). */
export const OVERLAY_SIZE: OverlaySize = { width: 480, height: 132 };

/** Gap between the overlay's bottom edge and the work-area bottom. */
export const OVERLAY_MARGIN_BOTTOM = 24;

/**
 * Compute the overlay bounds: horizontally centred, anchored to the bottom of
 * the work area with a fixed margin.
 */
export function computeOverlayBounds(
  workArea: OverlayRect,
  size: OverlaySize = OVERLAY_SIZE,
  marginBottom: number = OVERLAY_MARGIN_BOTTOM,
): OverlayRect {
  return {
    width: size.width,
    height: size.height,
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + workArea.height - size.height - marginBottom),
  };
}

/** BrowserWindow construction options shared by the overlay. */
export interface OverlayWindowOptions {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly alwaysOnTop: true;
  readonly transparent: true;
  readonly frame: false;
  readonly resizable: false;
  readonly show: false;
  readonly skipTaskbar: true;
  readonly hasShadow: false;
  readonly webPreferences: {
    readonly preload: string;
    readonly contextIsolation: true;
    readonly nodeIntegration: false;
    readonly sandbox: true;
  };
}

/**
 * Build the overlay BrowserWindow options. The overlay uses the SAME preload
 * script as the main window so the renderer's `window.piApp` bridge is shared.
 */
export function createOverlayWindowOptions(preloadPath: string, bounds: OverlayRect): OverlayWindowOptions {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    alwaysOnTop: true,
    transparent: true,
    frame: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

/** Minimal slice of Electron's `WebContents` the manager touches. */
export interface OverlayWebContents {
  send(channel: string, ...args: unknown[]): void;
  isDestroyed(): boolean;
}

/** Minimal slice of Electron's `BrowserWindow` the manager touches. */
export interface OverlayBrowserWindow {
  readonly webContents: OverlayWebContents;
  isDestroyed(): boolean;
  show(): void;
  focus(): void;
  close(): void;
  loadURL(url: string): Promise<void> | void;
  once(event: "ready-to-show" | "closed", listener: () => void): void;
}

export interface OverlayWindowManagerDeps {
  /** Create the overlay BrowserWindow from the given options. */
  readonly createWindow: (options: OverlayWindowOptions) => OverlayBrowserWindow;
  /** Resolve the work area (in screen coordinates) of the primary display. */
  readonly getWorkArea: () => OverlayRect;
  /** Absolute path to the shared preload script. */
  readonly preloadPath: string;
  /** Resolve the renderer URL for the overlay route (includes the `#overlay` hash). */
  readonly resolveOverlayUrl: () => string;
  /** Subscribe to store state changes; returns an unsubscribe fn. */
  readonly subscribeToState: (listener: (state: DesktopAppState) => void) => () => void;
  /** Read the current state to seed the overlay on open. */
  readonly getState: () => DesktopAppState | Promise<DesktopAppState>;
  /** Overlay dimensions (defaults to {@link OVERLAY_SIZE}). */
  readonly size?: OverlaySize;
  /** Bottom margin (defaults to {@link OVERLAY_MARGIN_BOTTOM}). */
  readonly marginBottom?: number;
}

/**
 * Owns the lifecycle of the single overlay window.
 */
export class OverlayWindowManager {
  private window: OverlayBrowserWindow | null = null;
  private stopPublishingState: (() => void) | undefined;
  private readonly deps: OverlayWindowManagerDeps;

  constructor(deps: OverlayWindowManagerDeps) {
    this.deps = deps;
  }

  /** Whether an overlay window currently exists and is alive. */
  isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  /**
   * Open the overlay. If one already exists, focus it instead of creating a
   * second window (single-instance).
   */
  open(): OverlayBrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return this.window;
    }

    const bounds = computeOverlayBounds(this.deps.getWorkArea(), this.deps.size, this.deps.marginBottom);
    const options = createOverlayWindowOptions(this.deps.preloadPath, bounds);
    const window = this.deps.createWindow(options);
    this.window = window;

    window.once("ready-to-show", () => {
      if (!window.isDestroyed()) {
        window.show();
      }
    });
    window.once("closed", () => {
      this.handleClosed(window);
    });

    this.attachStatePublisher(window);
    void window.loadURL(this.deps.resolveOverlayUrl());
    return window;
  }

  /** Close the overlay if it exists. */
  close(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
  }

  private attachStatePublisher(window: OverlayBrowserWindow): void {
    this.stopPublishingState?.();
    const send = (state: DesktopAppState) => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(desktopIpc.stateChanged, state);
      }
    };
    this.stopPublishingState = this.deps.subscribeToState(send);
    Promise.resolve(this.deps.getState()).then(send).catch(() => undefined);
  }

  private handleClosed(window: OverlayBrowserWindow): void {
    this.stopPublishingState?.();
    this.stopPublishingState = undefined;
    if (this.window === window) {
      this.window = null;
    }
  }
}
