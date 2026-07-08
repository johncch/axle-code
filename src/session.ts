import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentSession } from "@fifthrevision/axle";

const SESSIONS_DIR = resolve(process.cwd(), ".axle-code-sessions");

export interface SavedSessionFile {
  version: 1;
  modelId: string;
  savedAt: string;
  session: AgentSession;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, "_");
}

export async function saveSession(
  name: string,
  modelId: string,
  session: AgentSession,
): Promise<string> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  const payload: SavedSessionFile = {
    version: 1,
    modelId,
    savedAt: new Date().toISOString(),
    session,
  };
  const path = resolve(SESSIONS_DIR, `${sanitize(name)}.json`);
  await writeFile(path, JSON.stringify(payload, null, 2), "utf-8");
  return path;
}

export async function loadSession(name: string): Promise<SavedSessionFile> {
  const path = resolve(SESSIONS_DIR, `${sanitize(name)}.json`);
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as SavedSessionFile;
  if (parsed.version !== 1) {
    throw new Error(`Unsupported session file version: ${parsed.version}`);
  }
  return parsed;
}

export async function listSessions(): Promise<string[]> {
  try {
    const files = await readdir(SESSIONS_DIR);
    return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
  } catch {
    return [];
  }
}
