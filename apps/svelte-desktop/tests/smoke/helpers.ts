/**
 * Playwright smoke helpers — start a real Sidecar and serve
 * the SvelteKit static dist for end-to-end browser testing.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import {
  startSidecarServer,
  type SidecarServer,
} from "@pi-gui/sidecar";

export interface SmokeFixture {
  sidecar: SidecarServer;
  dataDir: string;
  baseUrl: string;
  sidecarPort: number;
  sidecarToken: string;
}

let fixture: SmokeFixture | null = null;

export async function setupSmoke(): Promise<SmokeFixture> {
  if (fixture) return fixture;

  const dataDir = mkdtempSync(join(tmpdir(), "pi-playwright-smoke-"));
  const sidecar = await startSidecarServer({ dataDir });

  fixture = {
    sidecar,
    dataDir,
    baseUrl: "http://localhost:4173",
    sidecarPort: sidecar.port,
    sidecarToken: sidecar.token,
  };

  return fixture;
}

export async function teardownSmoke(): Promise<void> {
  if (!fixture) return;
  await fixture.sidecar.stop();
  rmSync(fixture.dataDir, { recursive: true, force: true });
  fixture = null;
}

export function pageUrl(fixture: SmokeFixture): string {
  return `${fixture.baseUrl}/?sidecarPort=${fixture.sidecarPort}&sidecarToken=${fixture.sidecarToken}`;
}
