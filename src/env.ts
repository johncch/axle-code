import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

let loaded = false;

/**
 * Load a local .env first, then fall back to the sibling axle repo's .env so
 * the keys already configured there work with zero setup. Idempotent.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const candidate of [resolve(projectRoot, ".env"), resolve(projectRoot, "../axle/.env")]) {
    if (existsSync(candidate)) dotenv.config({ path: candidate, quiet: true });
  }
}
