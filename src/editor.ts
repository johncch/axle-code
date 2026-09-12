import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AXLE_HOME, CONFIG_FILENAME, CONFIG_HEADER } from "./config.js";

/** One editable config layer: a label for the picker and a real path. */
export interface SettingsTarget {
  /** Picker label, e.g. "user      /home/me/.axle/code.yaml". */
  label: string;
  /** Absolute path handed to the editor. */
  path: string;
}

/** The two config layers, in picker order: user-level, then project-local. */
export function settingsTargets(cwd: string = process.cwd()): SettingsTarget[] {
  return [
    { label: `user      ${resolve(AXLE_HOME, CONFIG_FILENAME)}`, path: resolve(AXLE_HOME, CONFIG_FILENAME) },
    { label: `project   ${resolve(cwd, ".axle", CONFIG_FILENAME)}`, path: resolve(cwd, ".axle", CONFIG_FILENAME) },
  ];
}

/** Value used for `VISUAL`/`EDITOR` when neither is set. */
const FALLBACK_EDITOR = "vi";

/** Resolve the user's editor from the environment. */
export function resolveEditor(env: NodeJS.ProcessEnv = process.env): string {
  return env.VISUAL?.trim() || env.EDITOR?.trim() || FALLBACK_EDITOR;
}

/** First line of the seeded file: real content only, no editor template. */
export async function seedConfig(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf-8");
    return false;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
    await writeFile(path, `${CONFIG_HEADER}\n`, "utf-8");
    return true;
  }
}

export interface EditResult {
  /** Path the editor was pointed at. */
  path: string;
  /** The `EDITOR`/`VISUAL` string that was spawned. */
  editor: string;
  /** The editor exited non-zero — likely nothing was written. */
  failed: boolean;
}

/**
 * Suspend-safe wrapper assumes the caller has already handed the terminal over
 * (Ink's `suspendTerminal`); this only owns the child process. Inherited stdio
 * is the point — the editor draws directly to the real terminal.
 */
export function editFile(target: SettingsTarget, env: NodeJS.ProcessEnv = process.env): Promise<EditResult> {
  // A whole command line ("code -w") is allowed, so go via the shell. Quote
  // the path so spaces survive; double quotes are safe inside a `sh -c`
  // string as long as the path itself has none — acceptable for config paths.
  const editor = resolveEditor(env);
  const command = `${editor} "${target.path}"`;
  return new Promise((resolvePromise) => {
    const child = spawn(command, { stdio: "inherit", shell: true });
    child.on("error", () => resolvePromise({ path: target.path, editor, failed: true }));
    child.on("exit", (code) => resolvePromise({ path: target.path, editor, failed: code !== 0 }));
  });
}
