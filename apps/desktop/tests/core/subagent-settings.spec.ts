import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getDesktopState, launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

test("subagents settings expose config and project agent manager", async () => {
  test.setTimeout(60_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("subagent-settings-workspace");
  const agentDir = join(userDataDir, "agent");
  await mkdir(join(agentDir, "agents"), { recursive: true });
  await writeFile(join(agentDir, "agents", "scout.md"), `---
name: scout
description: Global scout agent
model: openai/gpt-5
thinking: high
mode: background
async: true
---

Scout prompt.
`, "utf8");
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openAgentsView(window);

    await expect(window.getByRole("heading", { name: "Subagents", exact: true })).toBeVisible();
    await expect(window.getByText("Agent manager", { exact: true })).toBeVisible();
    await expect(window.locator(".subagent-settings-agent__name", { hasText: "scout" })).toBeVisible();
    await expect(window.locator(".subagent-settings-agent", { hasText: "scout" }).getByText("global", { exact: true })).toBeVisible();
    await expect(window.locator("input.settings-input").first()).toHaveAttribute("placeholder", "Bundled Pi command");

    await window.locator(".settings-row", { hasText: "Orchestrator mode" }).getByRole("button", { name: "Disabled" }).click();
    await expect.poll(async () => (await getDesktopState(window)).subagentSettings.orchestratorMode).toBe(true);

    await window.getByRole("button", { name: "New agent" }).click();
    const agentPath = join(workspacePath, ".pi", "agents", "new-agent.md");
    await expect.poll(async () => {
      try {
        return await readFile(agentPath, "utf8");
      } catch {
        return "";
      }
    }).toContain("name: new-agent");
    await expect(window.locator(".subagent-settings-agent__name", { hasText: "new-agent" })).toBeVisible();

    const agent = window.locator(".subagent-settings-agent", { hasText: "new-agent" });
    await agent.locator(":scope > summary").click();
    const modelValue = await agent.locator("select.settings-select").first().locator("option").nth(1).getAttribute("value");
    expect(modelValue).toBeTruthy();
    await agent.locator("select.settings-select").first().selectOption(modelValue ?? "");
    await agent.locator("select.settings-select").nth(1).selectOption("high");
    await expect.poll(() => readFile(agentPath, "utf8")).toContain(`model: ${modelValue}`);
    await expect.poll(() => readFile(agentPath, "utf8")).toContain("thinking: high");
  } finally {
    await harness.close();
  }
});

async function openAgentsView(window: Page): Promise<void> {
  await window.getByRole("button", { name: "Agents", exact: true }).click();
  await expect(window.getByTestId("agents-surface")).toBeVisible();
  await expect(window.locator(".view-header__title")).toContainText("Subagents");
}
