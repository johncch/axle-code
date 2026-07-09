import { Agent, createAgentTool } from "@fifthrevision/axle";
import { z } from "zod";
import { buildCatalog, defaultEntry, type ModelEntry } from "../models.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { listDirTool } from "./list-dir.js";
import { readFileTool } from "./read-file.js";

let cachedEntry: ModelEntry | undefined;
function childEntry(): ModelEntry {
  if (!cachedEntry) cachedEntry = defaultEntry(buildCatalog());
  return cachedEntry;
}

const schema = z.object({
  task: z.string().describe("A focused question or task about the codebase to investigate."),
});

const CHILD_SYSTEM = `You are a read-only code exploration sub-agent. Investigate the
given task using your tools (read, list, glob, grep) and report concise findings.
You cannot modify files. Be brief and specific.`;

export const exploreTool = createAgentTool({
  name: "explore",
  description:
    "Delegate a focused, read-only codebase investigation to a sub-agent that can read, list, glob, and grep. Returns its findings. Use for multi-step lookups you don't want cluttering the main thread.",
  schema,
  prompt: (input) => input.task,
  createAgent: () => {
    const entry = childEntry();
    if (!entry.provider) throw new Error(`${entry.label} is unavailable — set ${entry.keyEnv}.`);
    return new Agent({
      provider: entry.provider,
      model: entry.model,
      system: CHILD_SYSTEM,
      tools: [readFileTool, listDirTool, globTool, grepTool],
    });
  },
});
