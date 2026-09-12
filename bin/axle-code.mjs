#!/usr/bin/env node
// Thin launcher so `axle-code` runs from any directory. It spawns the bundled
// tsx on the TypeScript entry (no build step) and inherits the terminal so
// Ink's raw-mode TUI works. The agent operates on the current directory.
//
// Restart supervision: the app exits with RESTART_EXIT_CODE when it wants to
// be relaunched (e.g. after editing settings) — the bin respawns instead of
// returning to the shell, so the TTY never goes back to the shell mid-restart.
// The conversation carries over via the autosave the app writes before
// exiting. Keep the constant in sync with src/restart.ts (test/restart.test.ts
// guards against drift).
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const tsx = resolve(pkgRoot, "node_modules/.bin/tsx");
const entry = resolve(pkgRoot, "src/index.tsx");

// Match src/restart.ts.
const RESTART_EXIT_CODE = 75;

// React picks its development or production build from NODE_ENV when it is
// first imported. Running from source with no build step leaves NODE_ENV unset,
// which silently gets the development build — ~9% more CPU per keystroke, and
// noticeably worse worst-case input latency. `pnpm dev` is unaffected.
function launch(env) {
  return spawn(tsx, [entry], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: { ...env, NODE_ENV: env.NODE_ENV ?? "production" },
  });
}

for (;;) {
  const code = await new Promise((resolveExit) => {
    const child = launch(process.env);
    child.on("exit", (childCode, signal) => {
      resolveExit(signal ? 128 + 15 : (childCode ?? 0));
    });
  });
  // Any exit other than "restart me" hands the exit code to the shell, as before.
  if (code !== RESTART_EXIT_CODE) process.exit(code);
}
