import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const AXLE_HOME = resolve(homedir(), ".axle");
export const CREDENTIALS_PATH = resolve(AXLE_HOME, "credentials");
const CONFIG_PATH = resolve(AXLE_HOME, "config.json");

export interface AxleConfig {
  /** Model id (e.g. "anthropic:claude-sonnet-5") to start on. */
  defaultModel?: string;
}

export async function readConfig(): Promise<AxleConfig> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(await readFile(CONFIG_PATH, "utf-8")) as AxleConfig;
  } catch {
    return {};
  }
}

export async function writeConfig(patch: Partial<AxleConfig>): Promise<void> {
  const current = await readConfig();
  await mkdir(AXLE_HOME, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify({ ...current, ...patch }, null, 2), "utf-8");
}
