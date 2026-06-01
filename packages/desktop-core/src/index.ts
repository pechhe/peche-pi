export * from "./adapter.js";
export {
  createPlatformAdapter,
  type WindowFocusState,
} from "./create-platform-adapter.js";
export type { DesktopAppState } from "./state-shape.js";
export type { DesktopCore } from "./desktop-core.js";
export { DesktopCoreImpl, type CreateDesktopCoreOptions } from "./desktop-core-impl.js";
export type {
  CoreState,
  CoreWorkspaceRecord,
  CoreSessionRecord,
  CoreSessionCommandRecord,
} from "./core-state.js";
