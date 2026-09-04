import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const AXLE_HOME = resolve(homedir(), ".axle");
export const CREDENTIALS_PATH = resolve(AXLE_HOME, "credentials");
/** The one configuration file, read at both the global and project layer. */
export const CONFIG_FILENAME = "code.yaml";

export interface ConfigLocations {
  /** Directory holding the user-level config (default `~/.axle`). */
  globalDir?: string;
  /** Directory holding the project-local config (default `$PWD/.axle`). */
  projectDir?: string;
}

/**
 * Configuration: one file, `code.yaml`, read from two layers —
 *
 *   1. `~/.axle/code.yaml`   global (user-level)
 *   2. `.axle/code.yaml`     project-local, relative to where axle-code runs
 *
 * The layers merge with the local file winning per top-level key; `theme` and
 * `compaction` deep-merge, so a project can re-theme one token while keeping
 * global customisations, while `models` replaces the list wholesale.
 *
 * YAML is a JSON superset, so JSON content works anywhere. The previous split
 * files — `code.json` (prefs), `settings.json` (theme/compaction),
 * `models.json` (model list) — are still honored as a per-layer fallback
 * whenever that layer has no `code.yaml`, so existing setups keep working
 * until they migrate.
 *
 * Missing files, parse errors, or wrong shapes all degrade to "no config" —
 * a broken file must never block the app from launching, but it is reported
 * on stderr, since the user wrote that file on purpose.
 */
export interface AxleConfig {
  /** Model id (e.g. "anthropic/claude-sonnet-5") to start on. */
  defaultModel?: string;
  /** Model spec strings that replace the built-in catalog list. */
  models?: string[];
  /** Theme token overrides, e.g. `{ accent: "green", faint: "gray:dim" }`. */
  theme?: Record<string, unknown>;
  /**
   * Auto-compaction tuning. `threshold` is the estimated context size (in
   * tokens) at which compaction triggers before a turn; `target` is the size
   * the conversation shrinks toward. Omit to keep defaults.
   */
  compaction?: { threshold?: number; target?: number };
}

const CONFIG_HEADER = [
  "# axle-code configuration.",
  "# Loaded from ~/.axle/code.yaml and .axle/code.yaml (project-local wins).",
  "# Keys: defaultModel, models, theme, compaction — see the README.",
].join("\n");

/** Config problems are reported once per process, however often we re-read. */
const reported = new Set<string>();
function report(problem: string): void {
  if (reported.has(problem)) return;
  reported.add(problem);
  console.error(`[axle-code] config: ${problem}`);
}

/** Local wins per key; nested blocks merge key-by-key. */
function mergeConfigs(global: AxleConfig, local: AxleConfig): AxleConfig {
  const merged: AxleConfig = {};
  if (global.defaultModel !== undefined || local.defaultModel !== undefined) {
    merged.defaultModel = local.defaultModel ?? global.defaultModel;
  }
  if (global.models !== undefined || local.models !== undefined) {
    merged.models = local.models ?? global.models;
  }
  if (global.theme !== undefined || local.theme !== undefined) {
    merged.theme = { ...global.theme, ...local.theme };
  }
  if (global.compaction !== undefined || local.compaction !== undefined) {
    merged.compaction = { ...global.compaction, ...local.compaction };
  }
  return merged;
}

function sanitize(raw: unknown, source: string, problems: string[]): AxleConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    problems.push(`${source}: expected a mapping (defaultModel, models, theme, compaction) — ignoring the file`);
    return {};
  }
  const out: AxleConfig = {};
  const { defaultModel, models, theme, compaction } = raw as Record<string, unknown>;

  if (defaultModel !== undefined) {
    if (typeof defaultModel === "string" && defaultModel.length > 0) {
      out.defaultModel = defaultModel;
    } else {
      problems.push(`${source}: 'defaultModel' must be a non-empty string — ignoring it`);
    }
  }

  if (models !== undefined) {
    if (Array.isArray(models) && models.length > 0 && models.every((m) => typeof m === "string" && m.length > 0)) {
      out.models = models;
    } else {
      problems.push(
        `${source}: 'models' must be a non-empty list of spec strings ` +
          `(e.g. ["anthropic/claude-sonnet-5"]) — using the built-in list`,
      );
    }
  }

  if (theme !== undefined) {
    if (typeof theme === "object" && theme !== null && !Array.isArray(theme)) {
      out.theme = theme as Record<string, unknown>;
    } else {
      problems.push(`${source}: 'theme' must be a mapping of token overrides — ignoring it`);
    }
  }

  if (compaction !== undefined) {
    if (typeof compaction === "object" && compaction !== null && !Array.isArray(compaction)) {
      const block = compaction as Record<string, unknown>;
      const tuned: { threshold?: number; target?: number } = {};
      for (const key of ["threshold", "target"] as const) {
        const value = block[key];
        if (value === undefined) continue;
        if (typeof value === "number" && Number.isFinite(value)) {
          tuned[key] = value;
        } else {
          problems.push(`${source}: 'compaction.${key}' must be a finite number — ignoring it`);
        }
      }
      if (tuned.threshold !== undefined || tuned.target !== undefined) out.compaction = tuned;
    } else {
      problems.push(`${source}: 'compaction' must be a mapping with numeric 'threshold'/'target' — ignoring it`);
    }
  }

  return out;
}

/** Parse one config file. `undefined` = absent or empty; never throws. */
function readCodeFile(path: string, problems: string[]): AxleConfig | undefined {
  if (!existsSync(path)) return undefined;
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf-8"));
  } catch (err) {
    problems.push(`${path}: could not parse (${err instanceof Error ? err.message : err}) — ignoring`);
    return undefined;
  }
  if (raw === null || raw === undefined) return undefined; // empty file ≡ absent
  return sanitize(raw, path, problems);
}

/**
 * The pre-merge layout: three separate files per directory. `models.json` was
 * a bare JSON array rather than a mapping, so it gets its own reader that
 * wraps it into `{ models: [...] }` before sanitizing.
 */
function readLegacyLayer(dir: string, problems: string[]): AxleConfig | undefined {
  const parts: AxleConfig[] = [];
  const prefs = readCodeFile(resolve(dir, "code.json"), problems);
  if (prefs) parts.push(prefs);
  const settings = readCodeFile(resolve(dir, "settings.json"), problems);
  if (settings) parts.push(settings);
  const models = readLegacyModelsFile(resolve(dir, "models.json"), problems);
  if (models) parts.push(models);
  return parts.length ? parts.reduce((acc, part) => mergeConfigs(acc, part), {}) : undefined;
}

function readLegacyModelsFile(path: string, problems: string[]): AxleConfig | undefined {
  if (!existsSync(path)) return undefined;
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf-8"));
  } catch (err) {
    problems.push(`${path}: could not parse (${err instanceof Error ? err.message : err}) — ignoring`);
    return undefined;
  }
  return sanitize(Array.isArray(raw) ? { models: raw } : raw, path, problems);
}

/** Merge the global and project-local layers into one effective config. */
export function loadConfig(locations: ConfigLocations = {}): AxleConfig {
  const globalDir = locations.globalDir ?? AXLE_HOME;
  const projectDir = locations.projectDir ?? resolve(process.cwd(), ".axle");
  const problems: string[] = [];

  const global =
    readCodeFile(resolve(globalDir, CONFIG_FILENAME), problems) ?? readLegacyLayer(globalDir, problems) ?? {};
  const local =
    readCodeFile(resolve(projectDir, CONFIG_FILENAME), problems) ?? readLegacyLayer(projectDir, problems) ?? {};

  for (const problem of problems) report(problem);
  return mergeConfigs(global, local);
}

/**
 * Patch the user-level config, preserving every other key. Seeds the file
 * from the legacy trio when it doesn't exist yet, which migrates the global
 * layer to `code.yaml` on the first write (e.g. the first model switch).
 */
export async function writeConfig(patch: Partial<AxleConfig>, globalDir: string = AXLE_HOME): Promise<void> {
  const problems: string[] = [];
  const current =
    readCodeFile(resolve(globalDir, CONFIG_FILENAME), problems) ?? readLegacyLayer(globalDir, problems) ?? {};
  for (const problem of problems) report(problem);
  await mkdir(globalDir, { recursive: true });
  const body = stringifyYaml({ ...current, ...patch }).trimEnd();
  await writeFile(resolve(globalDir, CONFIG_FILENAME), `${CONFIG_HEADER}\n\n${body}\n`, "utf-8");
}
