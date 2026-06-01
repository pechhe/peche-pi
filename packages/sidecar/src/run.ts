#!/usr/bin/env node
/**
 * Sidecar entry point — starts the WebSocket server.
 *
 * Usage:
 *   node --import tsx src/run.ts --port 0 --data-dir /tmp/pi-sidecar
 *   bun run src/run.ts --port 0 --data-dir /tmp/pi-sidecar
 *
 * Environment:
 *   PI_SIDECAR_TOKEN — pre-generated auth token (optional, server generates one)
 *   PI_SIDECAR_PORT  — port to listen on (default 0 = random)
 *   PI_SIDECAR_DATA_DIR — data directory for persistence (required)
 */

import { startSidecarServer } from "./ws-server.js";

const port = parseInt(process.env.PI_SIDECAR_PORT ?? "0", 10);
const token = process.env.PI_SIDECAR_TOKEN ?? undefined;
const dataDir = process.env.PI_SIDECAR_DATA_DIR;

if (!dataDir) {
  console.error("PI_SIDECAR_DATA_DIR is required");
  process.exit(1);
}

try {
  const opts: { port: number; token?: string; dataDir: string } = {
    port: isNaN(port) ? 0 : port,
    dataDir,
  };
  if (token) {
    opts.token = token;
  }
  const server = await startSidecarServer(opts);

  // Signal to parent that we're ready
  if (process.send) {
    process.send({ type: "ready", port: server.port, token: server.token });
  }

  // Write connection info to stdout for process-based discovery
  console.log(
    JSON.stringify({ port: server.port, token: server.token }),
  );

  // Keep alive
  process.on("SIGTERM", async () => {
    await server.stop();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    await server.stop();
    process.exit(0);
  });

  // Prevent exit
  setInterval(() => {}, 1000 * 60 * 60);
} catch (err) {
  console.error("Sidecar failed to start:", err);
  process.exit(1);
}
