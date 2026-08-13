import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentSession, Turn } from "@fifthrevision/axle";

const SESSIONS_DIR = resolve(process.cwd(), ".axle-code-sessions");

/** Reserved slot for the auto-saved "resume on next launch" session. */
export const AUTOSAVE_NAME = "__current__";

export interface SavedSessionFile {
  version: 2;
  modelId: string;
  savedAt: string;
  /** Agent continuation state (sessionId + active messages). */
  session: AgentSession;
  /** Host-owned transcript turns, persisted separately from the AgentSession. */
  turns: Turn[];
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, "_");
}

// Write-then-rename so a crash or signal mid-write can never truncate an
// existing session file — the quit path saves while signal handlers are live,
// and a second SIGINT/SIGTERM force-kills the process at any point.
async function writeFileAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, data, "utf-8");
  await rename(tmp, path);
}

export async function saveSession(
  name: string,
  modelId: string,
  session: AgentSession,
  turns: Turn[],
): Promise<string> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  const payload: SavedSessionFile = {
    version: 2,
    modelId,
    savedAt: new Date().toISOString(),
    session,
    turns,
  };
  const path = resolve(SESSIONS_DIR, `${sanitize(name)}.json`);
  await writeFileAtomic(path, JSON.stringify(payload, null, 2));
  return path;
}

export async function loadSession(name: string): Promise<SavedSessionFile> {
  const path = resolve(SESSIONS_DIR, `${sanitize(name)}.json`);
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as {
    version: number;
    modelId: string;
    savedAt: string;
    session: AgentSession & { turns?: Turn[] };
    turns?: Turn[];
  };
  // Migrate v1 (pre-0.30) session files: turns were nested inside
  // session.turns; in v2 they're a top-level field and session is just
  // { sessionId, messages }.
  if (parsed.version === 1) {
    return {
      version: 2,
      modelId: parsed.modelId,
      savedAt: parsed.savedAt,
      session: {
        sessionId: parsed.session.sessionId,
        messages: parsed.session.messages,
      },
      turns: parsed.session.turns ?? [],
    };
  }
  if (parsed.version !== 2) {
    throw new Error(`Unsupported session file version: ${parsed.version as number}`);
  }
  return {
    version: 2,
    modelId: parsed.modelId,
    savedAt: parsed.savedAt,
    session: parsed.session,
    turns: parsed.turns ?? [],
  };
}

export async function listSessions(): Promise<string[]> {
  try {
    const files = await readdir(SESSIONS_DIR);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .filter((n) => n !== AUTOSAVE_NAME)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Roll the current autosave (`__current__.json`) into a timestamped archive and
 * leave a fresh blank session in its place.
 *
 * The archive name is derived from the current session's `savedAt` (or the
 * moment of rotation if absent) so multiple clears in a session never collide.
 * If `__current__.json` doesn't exist or is empty, this is a no-op archive but
 * still writes a blank current so the next launch is a clean start.
 *
 * Returns the archive filename (without extension) so the UI can surface it.
 */
export async function rotateCurrentSession(): Promise<string | null> {
  await mkdir(SESSIONS_DIR, { recursive: true });

  const currentPath = resolve(SESSIONS_DIR, `${AUTOSAVE_NAME}.json`);
  let archiveName: string | null = null;
  let haveCurrent = false;
  try {
    const raw = await readFile(currentPath, "utf-8");
    const parsed = JSON.parse(raw) as SavedSessionFile;
    if (parsed.turns && parsed.turns.length > 0) {
      haveCurrent = true;
      const stamp =
        parsed.savedAt ?? new Date().toISOString();
      archiveName = stampToArchiveName(stamp);
      const archivePath = resolve(SESSIONS_DIR, `${archiveName}.json`);
      await writeFileAtomic(archivePath, raw);
    }
  } catch {
    // Missing or corrupt current — nothing to archive.
  }

  // Write a blank current so the next launch starts fresh. We don't know the
  // model id here, so we preserve any we read, else leave it empty.
  const blank: SavedSessionFile = {
    version: 2,
    modelId: "",
    savedAt: new Date().toISOString(),
    session: { sessionId: "", messages: [] },
    turns: [],
  };
  await writeFileAtomic(currentPath, JSON.stringify(blank, null, 2));

  return haveCurrent ? archiveName : null;
}

function stampToArchiveName(stamp: string): string {
  // 2025-01-09T22:13:48.123Z -> 20250109-221348
  const d = new Date(stamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const da = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  let name = `${y}${mo}${da}-${h}${mi}${s}`;
  // De-duplicate against any existing archive with the same stem.
  return name;
}
