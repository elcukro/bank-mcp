/**
 * `bank-mcp connect` — now delegates to the unified `init` flow.
 *
 * Kept for backward compatibility. All guided setup is handled by `init`.
 */
import * as p from "@clack/prompts";
import { runInit } from "./init.js";

export async function runConnect(): Promise<void> {
  p.log.warn("Note: 'connect' is now part of 'init'. Launching guided setup...");
  await runInit();
}
