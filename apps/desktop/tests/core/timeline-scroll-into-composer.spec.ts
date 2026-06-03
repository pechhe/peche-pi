import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  selectSession,
} from "../helpers/electron-app";

// Regression for the composer scroll-clipping behaviour:
//   1. `.composer` carries no top padding (the 18px of breathing room
//      lives in `.composer__surface`'s top padding instead) so the
//      conversation does not stop short of the visible prompt box.
//   2. The composer overlaps the conversation by the surface corner
//      radius (`margin-top: -20px`, `z-index: 2`). The opaque surface
//      covers content over its solid body, and where its rounded top
//      corners curve away the conversation content behind shows through
//      \u2014 filling the corner gap instead of being clipped flat.
const COMPOSER_OVERLAP_PX = 20;

test("composer overlaps the conversation so content fills the rounded corners", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("scroll-into");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Scroll");
    await selectSession(window, "Scroll");

    const measure = () =>
      window.evaluate(() => {
        const composer = document.querySelector(".composer") as HTMLElement | null;
        const surface = document.querySelector(".composer__surface") as HTMLElement | null;
        const pane = document.querySelector(".timeline-pane--thread") as HTMLElement | null;
        if (!composer || !surface || !pane) return null;
        const cc = getComputedStyle(composer);
        const sc = getComputedStyle(surface);
        const surfaceRect = surface.getBoundingClientRect();
        const paneRect = pane.getBoundingClientRect();
        return {
          composerPaddingTop: cc.paddingTop,
          composerMarginTop: cc.marginTop,
          composerZIndex: cc.zIndex,
          surfacePaddingTop: sc.paddingTop,
          surfaceRadius: sc.borderTopLeftRadius,
          // Pane extends below the surface top by the overlap amount so
          // content scrolls behind the composer and fills its corners.
          paneBelowSurface: Math.round(paneRect.bottom - surfaceRect.top),
        };
      });

    // Default composer
    const def = await measure();
    expect(def).not.toBeNull();
    expect(def!.composerPaddingTop).toBe("0px");
    expect(def!.surfacePaddingTop).toBe("30px"); // 12 + 18
    expect(def!.composerMarginTop).toBe(`-${COMPOSER_OVERLAP_PX}px`);
    expect(def!.composerZIndex).toBe("2");
    expect(def!.paneBelowSurface).toBe(COMPOSER_OVERLAP_PX);

    // Device mode (modular CRT)
    await window.evaluate(async () => {
      // @ts-ignore
      await window.piApp.setComposerDeviceMode("modular");
    });
    await window.waitForTimeout(300);

    const dev = await measure();
    expect(dev).not.toBeNull();
    expect(dev!.composerPaddingTop).toBe("0px");
    expect(dev!.surfacePaddingTop).toBe("40px"); // 22 + 18
    expect(dev!.surfaceRadius).toBe("20px"); // rounded top corners kept
    expect(dev!.composerMarginTop).toBe(`-${COMPOSER_OVERLAP_PX}px`);
    expect(dev!.paneBelowSurface).toBe(COMPOSER_OVERLAP_PX);
  } finally {
    await harness.close();
  }
});
