import { getContext, setContext } from "svelte";
import type { DesktopClientStore } from "./desktop-client";

const KEY = Symbol("desktopClient");

export function setDesktopClient(store: DesktopClientStore): void {
  setContext(KEY, store);
}

export function getDesktopClient(): DesktopClientStore {
  return getContext<DesktopClientStore>(KEY);
}
