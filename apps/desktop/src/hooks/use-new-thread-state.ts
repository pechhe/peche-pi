import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

import type {
  AppView,
  ComposerAttachment,
  DesktopAppState,
  NewThreadEnvironment,
  WorkspaceRecord,
} from "../desktop-state";
import { resolveRepoWorkspaceId } from "../workspace-roots";
import { readComposerAttachmentsFromFiles } from "../composer-attachments";
import type { ComposerMode } from "../composer-mode";

export interface NewThreadState {
  readonly rootWorkspaceId: string;
  readonly isChat: boolean;
  readonly environment: NewThreadEnvironment;
  readonly prompt: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly pendingWorkspaceId: string;
  readonly composerMode: ComposerMode;
  readonly orchestratorMode: boolean;

  readonly setRootWorkspaceId: Dispatch<SetStateAction<string>>;
  readonly setIsChat: Dispatch<SetStateAction<boolean>>;
  readonly setEnvironment: Dispatch<SetStateAction<NewThreadEnvironment>>;
  readonly setPrompt: Dispatch<SetStateAction<string>>;
  readonly setAttachments: Dispatch<SetStateAction<readonly ComposerAttachment[]>>;
  readonly setProvider: Dispatch<SetStateAction<string | undefined>>;
  readonly setModelId: Dispatch<SetStateAction<string | undefined>>;
  readonly setThinkingLevel: Dispatch<SetStateAction<string | undefined>>;
  readonly setPendingWorkspaceId: Dispatch<SetStateAction<string>>;
  readonly setComposerMode: Dispatch<SetStateAction<ComposerMode>>;
  readonly setOrchestratorMode: Dispatch<SetStateAction<boolean>>;

  readonly reset: (workspaceId?: string) => void;
  readonly open: (workspaceId?: string) => void;
  readonly openChat: () => void;
  readonly addAttachments: (files: File[]) => void;
  readonly removeAttachment: (attachmentId: string) => void;
  readonly clearAllDrafts: () => void;

}

export function useNewThreadState(params: {
  snapshot: DesktopAppState | null;
  rootWorkspaceOptions: readonly WorkspaceRecord[];
  rootWorkspace: WorkspaceRecord | undefined;
  visibleWorkspaces: readonly WorkspaceRecord[];
  api: NonNullable<typeof window.piApp> | undefined;
  setActiveView: (view: AppView) => void;
  focusNewThreadComposer: () => void;
}): NewThreadState {
  const { snapshot, rootWorkspaceOptions, rootWorkspace, visibleWorkspaces, api, setActiveView, focusNewThreadComposer } = params;

  const [rootWorkspaceId, setRootWorkspaceId] = useState("");
  const [isChat, setIsChat] = useState(false);
  const [environment, setEnvironment] = useState<NewThreadEnvironment>("local");
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState("");
  const [composerMode, setComposerMode] = useState<ComposerMode>("build");
  const [orchestratorMode, setOrchestratorMode] = useState(snapshot?.subagentSettings.orchestratorMode ?? false);

  // Per-project draft text + attachments. Keyed by rootWorkspaceId so each
  // project remembers what the user typed while navigating elsewhere.
  const [promptByWorkspace, setPromptByWorkspace] = useState<Record<string, string>>({});
  const [attachmentsByWorkspace, setAttachmentsByWorkspace] = useState<
    Record<string, readonly ComposerAttachment[]>
  >({});

  const prompt = promptByWorkspace[rootWorkspaceId] ?? "";
  const attachments = attachmentsByWorkspace[rootWorkspaceId] ?? [];

  const setPrompt = useCallback(
    (value: SetStateAction<string>) => {
      setPromptByWorkspace((prev) => {
        const key = rootWorkspaceId;
        if (!key) return prev;
        const current = prev[key] ?? "";
        const next = typeof value === "function" ? (value as (p: string) => string)(current) : value;
        if (next === current) return prev;
        return { ...prev, [key]: next };
      });
    },
    [rootWorkspaceId],
  );

  const setAttachments = useCallback(
    (value: SetStateAction<readonly ComposerAttachment[]>) => {
      setAttachmentsByWorkspace((prev) => {
        const key = rootWorkspaceId;
        if (!key) return prev;
        const current = prev[key] ?? [];
        const next =
          typeof value === "function"
            ? (value as (p: readonly ComposerAttachment[]) => readonly ComposerAttachment[])(current)
            : value;
        if (next === current) return prev;
        return { ...prev, [key]: next };
      });
    },
    [rootWorkspaceId],
  );

  const [provider, setProvider] = useState<string | undefined>();
  const [modelId, setModelId] = useState<string | undefined>();
  const [thinkingLevel, setThinkingLevel] = useState<string | undefined>();

  const reset = useCallback((workspaceId?: string) => {
    const nextWorkspaceId =
      (workspaceId && (
        rootWorkspaceOptions.find((workspace) => workspace.id === workspaceId)?.id ||
        (snapshot ? resolveRepoWorkspaceId(snapshot.workspaces, workspaceId) : undefined)
      )) ||
      rootWorkspace?.id ||
      visibleWorkspaces[0]?.id ||
      "";
    if (nextWorkspaceId) {
      setRootWorkspaceId(nextWorkspaceId);
    }
    setEnvironment("local");
    // Draft text + attachments are per-project (see promptByWorkspace) and
    // intentionally preserved here so that navigating away and back to the
    // new-thread surface keeps what the user typed. They are cleared only
    // on successful submit.
    setProvider(undefined);
    setModelId(undefined);
    setThinkingLevel(undefined);
    setComposerMode("build");
    setOrchestratorMode(snapshot?.subagentSettings.orchestratorMode ?? false);
  }, [rootWorkspaceOptions, snapshot, rootWorkspace, visibleWorkspaces]);

  const open = useCallback((workspaceId?: string) => {
    setPendingWorkspaceId("");
    setIsChat(false);
    reset(workspaceId);
    if (api) setActiveView("new-thread");
  }, [api, setActiveView, reset]);

  const openChat = useCallback(() => {
    setPendingWorkspaceId("");
    setIsChat(true);
    setEnvironment("local");
    setProvider(undefined);
    setModelId(undefined);
    setThinkingLevel(undefined);
    setComposerMode("build");
    setOrchestratorMode(snapshot?.subagentSettings.orchestratorMode ?? false);
    setActiveView("new-thread");
    focusNewThreadComposer();
  }, [setActiveView, focusNewThreadComposer, snapshot]);

  const addAttachments = useCallback((files: File[]) => {
    void readComposerAttachmentsFromFiles(files).then((newAttachments) => {
      if (newAttachments.length === 0) return;
      setAttachments((current) => [...current, ...newAttachments]);
    });
  }, [setAttachments]);

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) => current.filter((a) => a.id !== attachmentId));
  }, [setAttachments]);

  const clearAllDrafts = useCallback(() => {
    setPromptByWorkspace({});
    setAttachmentsByWorkspace({});
  }, []);

  return {
    rootWorkspaceId,
    isChat,
    environment,
    prompt,
    attachments,
    provider,
    modelId,
    thinkingLevel,
    pendingWorkspaceId,
    composerMode,
    orchestratorMode,
    setRootWorkspaceId,
    setIsChat,
    setEnvironment,
    setPrompt,
    setAttachments,
    setProvider,
    setModelId,
    setThinkingLevel,
    setPendingWorkspaceId,
    setComposerMode,
    setOrchestratorMode,
    reset,
    open,
    openChat,
    addAttachments,
    removeAttachment,
    clearAllDrafts,
  };
}
