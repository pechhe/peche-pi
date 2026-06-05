import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
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
