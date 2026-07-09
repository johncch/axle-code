#!/usr/bin/env node
// Thin launcher so `axle-code` runs from any directory. It execs the bundled
// tsx on the TypeScript entry (no build step) and inherits the terminal so
// Ink's raw-mode TUI works. The agent operates on the current directory.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const tsx = resolve(pkgRoot, "node_modules/.bin/tsx");
const entry = resolve(pkgRoot, "src/index.tsx");

const child = spawn(tsx, [entry], { stdio: "inherit", cwd: process.cwd() });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
