import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  startThreadViaIpc,
} from "../helpers/electron-app";

test("wrap template frames the sent message when toggle is ON", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-wrap-on");
  await seedAgentDir(agentDir);

  const chassisDir = join(agentDir, "chassis");
  await mkdir(chassisDir, { recursive: true });
  await writeFile(
    join(chassisDir, "state.json"),
    JSON.stringify({
      actions: [
        {
          id: "wrap-explain",
          label: "Explain",
          showLabel: true,
          trigger: "sticky",
          effect: { type: "wrap", template: "Explain step by step:\n{{input}}" },
        },
      ],
    }),
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    // Create a thread
    await startThreadViaIpc(window, { prompt: "Initial prompt" });
    const composer = window.getByTestId("composer");
    await expect(composer).toBeVisible({ timeout: 15_000 });

    // Wait for session to settle (initial prompt may have triggered a run)
    await window.waitForTimeout(3_000);

    // Toggle the wrap ON
    const toggle = window.getByTestId("chassis-action-wrap-explain");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // Type and send a message
    await composer.fill("What is a closure?");
    await composer.press("Enter");

    // The transcript should contain the wrapped message — the template
    // "Explain step by step:\n{{input}}" with {{input}} replaced by the typed text
    await expect(window.getByTestId("transcript")).toContainText("Explain step by step:", { timeout: 15_000 });
    await expect(window.getByTestId("transcript")).toContainText("What is a closure?", { timeout: 5_000 });
  } finally {
    await harness.close();
  }
});

test("raw text is sent when wrap toggle is OFF", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-wrap-off");
  await seedAgentDir(agentDir);

  const chassisDir = join(agentDir, "chassis");
  await mkdir(chassisDir, { recursive: true });
  await writeFile(
    join(chassisDir, "state.json"),
    JSON.stringify({
      actions: [
        {
          id: "wrap-explain",
          label: "Explain",
          showLabel: true,
          trigger: "sticky",
          effect: { type: "wrap", template: "Explain step by step:\n{{input}}" },
        },
      ],
    }),
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    await startThreadViaIpc(window, { prompt: "Initial prompt" });
    const composer = window.getByTestId("composer");
    await expect(composer).toBeVisible({ timeout: 15_000 });

    // Wait for session to settle
    await window.waitForTimeout(3_000);

    // Toggle ON then OFF
    const toggle = window.getByTestId("chassis-action-wrap-explain");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    // Send a message — should be raw, not wrapped
    await composer.fill("Hello raw");
    await composer.press("Enter");

    // The transcript should contain "Hello raw" but NOT the wrapper prefix
    await expect(window.getByTestId("transcript")).toContainText("Hello raw", { timeout: 15_000 });
    // Verify the wrap prefix is NOT present
    const transcriptText = await window.getByTestId("transcript").innerText();
    expect(transcriptText).not.toContain("Explain step by step:");
  } finally {
    await harness.close();
  }
});
