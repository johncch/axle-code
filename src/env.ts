import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { CREDENTIALS_PATH } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

let loaded = false;

/**
 * Populate provider keys, in precedence order (dotenv keeps the first value it
 * sees for a given key, so earlier candidates win):
 *   1. project .env         — local dev overrides
 *   2. ~/.axle/credentials  — the global, use-anywhere credentials file
 * Idempotent.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const candidate of [resolve(projectRoot, ".env"), CREDENTIALS_PATH]) {
    if (existsSync(candidate)) dotenv.config({ path: candidate, quiet: true });
  }
}
