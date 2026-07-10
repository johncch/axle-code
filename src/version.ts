import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve against this file's location (the install/checkout), not the cwd the
// agent is launched in — so `/version` reports the tool's own build.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface VersionInfo {
  version: string;
  axleVersion: string;
  sha: string;
  commitDate: string;
  dirty: boolean;
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function readVersion(path: string): string {
  try {
    return (JSON.parse(readFileSync(path, "utf-8")) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

let cached: VersionInfo | undefined;

export function getVersionInfo(): VersionInfo {
  if (cached) return cached;
  cached = {
    version: readVersion(resolve(repoRoot, "package.json")),
    axleVersion: readVersion(resolve(repoRoot, "node_modules/@fifthrevision/axle/package.json")),
    sha: git(["rev-parse", "--short", "HEAD"]) ?? "unknown",
    commitDate: git(["log", "-1", "--format=%cd", "--date=short"]) ?? "unknown",
    dirty: Boolean(git(["status", "--porcelain"])),
  };
  return cached;
}

export function formatVersion(info: VersionInfo = getVersionInfo()): string {
  const sha = info.dirty ? `${info.sha}*` : info.sha;
  return `axle-code ${info.version} · ${sha} · built ${info.commitDate} · axle ${info.axleVersion}`;
}
