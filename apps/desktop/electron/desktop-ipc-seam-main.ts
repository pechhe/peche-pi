/**
 * Main-process half of the Desktop IPC Seam.
 *
 * This module imports the Electron runtime (`ipcMain`) and registers handlers
 * from the contract registry defined in `desktop-ipc-seam.ts`. It is kept
 * separate so the contract metadata module stays free of any runtime Electron
 * import and can be exercised under plain `node --test`.
 */

import { ipcMain } from "electron";
import { desktopIpcContracts } from "./desktop-ipc-seam";

export type InvokeHandler = (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>;
export type SendHandler = (event: unknown, ...args: unknown[]) => void;

export interface MainHandlerAdapters {
  /** Map from methodName → handler function for invoke/send/sendSync channels. */
  readonly handlers: Record<string, InvokeHandler | SendHandler>;
}

/**
 * Register all ipcMain handlers from the contract registry.
 *
 * For `invoke` contracts: calls ipcMain.handle(channel, handler)
 * For `send`/`sendSync` contracts: calls ipcMain.on(channel, handler)
 * For `eventOnly` contracts: skipped (main process sends, renderer subscribes)
 *
 * Handlers that need validation should check `contract.validate` before
 * delegating to their adapter. The register function runs validate
 * automatically if the contract has a validate function.
 */
export function registerMainHandlers(adapters: MainHandlerAdapters): void {
  for (const contract of desktopIpcContracts) {
    if (contract.eventOnly || contract.local) {
      continue;
    }

    const handler = adapters.handlers[contract.methodName];
    if (!handler) {
      // Handler not yet migrated — skip silently.
      // Once all channels are migrated, this should throw.
      continue;
    }

    if (contract.kind === "invoke") {
      const invokeHandler = handler as InvokeHandler;
      const wrapped: InvokeHandler = contract.validate
        ? (event, ...args) => {
            contract.validate!(...args);
            return invokeHandler(event, ...args);
          }
        : invokeHandler;
      ipcMain.handle(contract.channel, wrapped);
    } else if (contract.kind === "send" || contract.kind === "sendSync") {
      const sendHandler = handler as SendHandler;
      const wrapped: SendHandler = contract.validate
        ? (event, ...args) => {
            contract.validate!(...args);
            return sendHandler(event, ...args);
          }
        : sendHandler;
      ipcMain.on(contract.channel, wrapped);
    }
  }
}
