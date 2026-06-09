import type { PiDesktopApi } from "./ipc";

export {};

// Vite inlines `?inline` asset imports as data: URI strings. vite/client declares
// these for the renderer build, but the main-process typecheck
// (tsconfig.electron.json) also includes src/**, so declare them here too.
declare module "*.mp3?inline" {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    piApp?: PiDesktopApi;
  }
}
