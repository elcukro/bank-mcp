/**
 * `bank-mcp connect` — now delegates to the unified `init` flow.
 *
 * Kept for backward compatibility. All guided setup is handled by `init`.
 */
import { runInit } from "./init.js";

export async function runConnect(): Promise<void> {
  console.log("  Note: 'connect' is now part of 'init'. Launching guided setup...\n");
  await runInit();
}
