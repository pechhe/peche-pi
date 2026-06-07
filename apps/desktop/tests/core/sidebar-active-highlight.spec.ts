import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSession,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

// Regression: the active sidebar highlight is rendered by the JS moving
// indicator (`.session-row--active` itself is transparent). The indicator must
// stay visible AND re-measure onto the row whose `--active` class moved when a
// different thread is selected.
async function activeIndicatorBox(window: Page) {
  const indicator = window.locator(".session-list .sidebar-moving-highlight__indicator--active").first();
  const opacity = await indicator.evaluate((el) => getComputedStyle(el).opacity);
  const box = await indicator.boundingBox();
  return { opacity, box };
}

test("active thread highlight follows the selected session", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("active-highlight-workspace");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    await createNamedThread(window, "Highlight thread one");
    await createNamedThread(window, "Highlight thread two");

    // Select thread one and confirm the active indicator is visible over it.
    await selectSession(window, "Highlight thread one");
    const rowOne = window.locator(".session-row", { hasText: "Highlight thread one" });
    await expect(rowOne).toHaveClass(/session-row--active/);

    await expect
      .poll(async () => (await activeIndicatorBox(window)).opacity)
      .toBe("1");

    const overRowOne = await expect
      .poll(async () => {
        const { box } = await activeIndicatorBox(window);
        const rowBox = await rowOne.boundingBox();
        if (!box || !rowBox) return null;
        const indicatorCenter = box.y + box.height / 2;
        return indicatorCenter >= rowBox.y && indicatorCenter <= rowBox.y + rowBox.height;
      })
      .toBe(true);
    void overRowOne;

    // Select thread two: the indicator must remain visible and move onto it.
    await selectSession(window, "Highlight thread two");
    const rowTwo = window.locator(".session-row", { hasText: "Highlight thread two" });
    await expect(rowTwo).toHaveClass(/session-row--active/);

    await expect
      .poll(async () => (await activeIndicatorBox(window)).opacity)
      .toBe("1");

    await expect
      .poll(async () => {
        const { box } = await activeIndicatorBox(window);
        const rowBox = await rowTwo.boundingBox();
        if (!box || !rowBox) return null;
        const indicatorCenter = box.y + box.height / 2;
        return indicatorCenter >= rowBox.y && indicatorCenter <= rowBox.y + rowBox.height;
      })
      .toBe(true);
  } finally {
    await harness.close();
  }
});

test("active thread highlight follows selected session after composer submit reorders rows", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("active-highlight-reorder-workspace");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    await createNamedThread(window, "Finished top thread");
    await createNamedThread(window, "Selected second thread");
    await selectSession(window, "Selected second thread");

    const selectedRow = window.locator(".session-list > .session-row").filter({ hasText: "Selected second thread" }).first();
    await expect(selectedRow).toHaveClass(/session-row--active/);

    const composer = window.getByTestId("composer");
    await composer.fill("Move selected thread upward");
    await composer.press("Enter");

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions[0]?.title ?? "";
      })
      .toBe("Selected second thread");

    await expect(selectedRow).toHaveClass(/session-row--active/);
    await expect
      .poll(async () => {
        const { box } = await activeIndicatorBox(window);
        const rowBox = await selectedRow.boundingBox();
        if (!box || !rowBox) return false;
        const indicatorCenter = box.y + box.height / 2;
        return indicatorCenter >= rowBox.y && indicatorCenter <= rowBox.y + rowBox.height;
      })
      .toBe(true);
  } finally {
    await harness.close();
  }
});
