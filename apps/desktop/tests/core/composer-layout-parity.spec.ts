import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
  seedAgentDir,
} from "../helpers/electron-app";

test.describe("Composer Layout Default Parity", () => {
  test("default layout renders controls in exact same order as hardcoded row", async ({ page }) => {
    test.setTimeout(30_000);
    
    const userDataDir = await makeUserDataDir();
    const workspaceRoot = await makeWorkspace("layout-parity");
    await seedAgentDir(workspaceRoot);
    
    const { app } = await launchDesktop({ userDataDir });
    await waitForWorkspaceByPath(app, workspaceRoot);
    
    // Check the composer controls are present and in the right order
    const controls = page.locator('.composer__controls, .composer-layout-grid');
    await expect(controls).toBeVisible();
    
    // Verify the default layout shows controls in this order:
    // mode · model · reasoning (caveman) · orchestrate · badges · send
    const modeSelector = page.locator('[data-testid="composer-mode-selector"]');
    const modelSelector = page.locator('.model-selector');
    const cavemanSelector = page.locator('.caveman-selector');
    const orchestrateSwitch = page.locator('[data-testid="orchestrate-switch"]');
    const badges = page.locator('.model-feature-badges');
    const sendButton = page.locator('[data-testid="send"]');
    
    // All controls should be visible
    await expect(modeSelector).toBeVisible();
    await expect(modelSelector).toBeVisible();
    await expect(cavemanSelector).toBeVisible();
    await expect(orchestrateSwitch).toBeVisible();
    await expect(badges).toBeVisible();
    await expect(sendButton).toBeVisible();
    
    // Verify they're in the expected order using bounding boxes
    const modeBox = await modeSelector.boundingBox();
    const modelBox = await modelSelector.boundingBox();
    const cavemanBox = await cavemanSelector.boundingBox();
    const orchestrateBox = await orchestrateSwitch.boundingBox();
    const sendBox = await sendButton.boundingBox();
    
    expect(modeBox).toBeTruthy();
    expect(modelBox).toBeTruthy();
    expect(cavemanBox).toBeTruthy();
    expect(orchestrateBox).toBeTruthy();
    expect(sendBox).toBeTruthy();
    
    // Mode should be leftmost
    expect(modelBox!.x).toBeGreaterThan(modeBox!.x);
    expect(cavemanBox!.x).toBeGreaterThan(modelBox!.x);
    expect(orchestrateBox!.x).toBeGreaterThan(cavemanBox!.x);
    // Send should be rightmost
    expect(sendBox!.x).toBeGreaterThan(orchestrateBox!.x);
    
    await app.close();
  });

  test("required controls cannot be removed", async ({ page }) => {
    test.setTimeout(30_000);
    
    const userDataDir = await makeUserDataDir();
    const workspaceRoot = await makeWorkspace("required-controls");
    await seedAgentDir(workspaceRoot);
    
    const { app } = await launchDesktop({ userDataDir });
    await waitForWorkspaceByPath(app, workspaceRoot);
    
    // Verify the required controls are marked as such
    const modelControl = page.locator('[data-unit-id="builtin:model"]');
    const reasoningControl = page.locator('[data-unit-id="builtin:reasoning"]');
    const sendControl = page.locator('[data-unit-id="builtin:send"]');
    
    // All required controls should be present
    await expect(modelControl).toBeVisible();
    await expect(reasoningControl).toBeVisible();
    await expect(sendControl).toBeVisible();
    
    // They should have the required attribute
    await expect(modelControl).toHaveAttribute('data-required', '');
    await expect(reasoningControl).toHaveAttribute('data-required', '');
    await expect(sendControl).toHaveAttribute('data-required', '');
    
    await app.close();
  });
});