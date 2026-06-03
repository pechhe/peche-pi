import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  resolveDeferredThreadTitleEventually,
  setDeferredThreadTitleMode,
  startChatViaIpc,
} from "../helpers/electron-app";

test("auto-titles a brand-new chat after showing the placeholder first", async () => {
  const userDataDir = await makeUserDataDir("pi-app-user-data-");
  const harness = await launchDesktop(userDataDir, {
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await setDeferredThreadTitleMode(harness);

    await startChatViaIpc(window, {
      prompt: "Help me brainstorm names for a new espresso bar",
    });

    const chats = window.locator(".sidebar__chats");
    await expect(chats.locator(".session-row__title", { hasText: "New chat" }).first()).toBeVisible();

    await resolveDeferredThreadTitleEventually(harness, "Espresso bar names");

    await expect(chats.locator(".session-row__title", { hasText: "Espresso bar names" }).first()).toBeVisible();
    await expect(chats.locator(".session-row__title", { hasText: "New chat" })).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
