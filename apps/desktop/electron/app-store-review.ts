import type { DesktopAppState } from "../src/desktop-state";
import { reduce } from "./app-state-reducer";
import type { AppStoreInternals } from "./app-store-internals";

export async function setCommitPushModel(
  store: AppStoreInternals,
  _workspaceId: string,
  model: string,
): Promise<DesktopAppState> {
  await store.initialize();
  const next = reduce(store.state, { type: "settings/setCommitPushModel", commitPushModel: model });
  if (next === store.state) {
    return store.emit();
  }
  store.state = next;
  await store.persistUiState();
  return store.emit();
}
