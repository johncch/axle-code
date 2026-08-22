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

/**
 * User settings: the hand-edited counterpart to `config.json` (which we
 * manage). Loaded from `.axle/settings.json` — project-local first, then
 * global `~/.axle/` — with deep-merged `theme` blocks, so a project can
 * re-theme one token while keeping global customisations. Missing files,
 * parse errors, or wrong shapes all degrade to "no settings" — a broken file
 * must never block the app from launching.
 */
export interface Settings {
  /** Theme token overrides, e.g. `{ "accent": "green", "faint": "gray:dim" }`. */
  theme?: Record<string, unknown>;
  /**
   * Auto-compaction tuning. `threshold` is the estimated context size (in
   * tokens) at which compaction triggers before a turn; `target` is the size
   * the conversation shrinks toward. Omit to keep defaults.
   */
  compaction?: { threshold?: number; target?: number };
}

function mergeSettings(a: Settings, b: Settings): Settings {
  return {
    ...a,
    ...b,
    ...(a.theme || b.theme ? { theme: { ...a.theme, ...b.theme } } : {}),
    ...(a.compaction || b.compaction
      ? {
          compaction: {
            ...a.compaction,
            ...b.compaction,
          },
        }
      : {}),
  };
}

async function readSettingsFile(path: string): Promise<Settings> {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Settings = {};
    const { theme, compaction } = parsed as Record<string, unknown>;
    if (typeof theme === "object" && theme !== null && !Array.isArray(theme)) {
      out.theme = theme as Record<string, unknown>;
    }
    if (typeof compaction === "object" && compaction !== null && !Array.isArray(compaction)) {
      const { threshold, target } = compaction as Record<string, unknown>;
      out.compaction = {};
      if (typeof threshold === "number" && Number.isFinite(threshold)) {
        out.compaction.threshold = threshold;
      }
      if (typeof target === "number" && Number.isFinite(target)) {
        out.compaction.target = target;
      }
    }
    return out;
  } catch {
    // Unreadable settings shouldn't be silent — the user wrote that file on
    // purpose. Surface it, then continue with defaults.
    console.error(`[axle-code] settings: could not parse ${path}; using defaults`);
    return {};
  }
}

/** Project-local `.axle/settings.json`, layered over global `~/.axle/`. */
export async function readSettings(): Promise<Settings> {
  const global = await readSettingsFile(resolve(AXLE_HOME, "settings.json"));
  const local = await readSettingsFile(resolve(process.cwd(), ".axle", "settings.json"));
  return mergeSettings(global, local);
}
