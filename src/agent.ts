import { Agent } from "@fifthrevision/axle";
import type { AgentSession, ExecutableTool } from "@fifthrevision/axle";
import { createCompactionCallback } from "./compaction.js";
import { buildCatalog, defaultEntry, type ModelEntry } from "./models.js";

const SUMMARIZER_SYSTEM =
  "You summarize coding-assistant conversations into concise, faithful briefings.";

const SYSTEM_PROMPT = `You are axle-code, a terminal coding assistant.

You help the user read, write, and modify code in their working directory. When
a task requires inspecting or changing files, use the provided tools rather than
guessing. Prefer small, verifiable steps. Keep prose concise; let tool results
speak for themselves.`;

export interface AgentFactoryOptions {
  tools?: ExecutableTool[];
  system?: string;
}

/**
 * Returns a factory that builds an Agent for any catalog entry, optionally
 * restoring a prior session so a model switch continues the same conversation.
 */
export function makeAgentFactory(options: AgentFactoryOptions = {}) {
  const tools = options.tools ?? [];
  const system = options.system ?? SYSTEM_PROMPT;
  return (entry: ModelEntry, session?: AgentSession): Agent => {
    const agent = new Agent(
      { provider: entry.provider, model: entry.model, system, tools },
      session,
    );
    agent.onCompaction(
      createCompactionCallback(
        () =>
          new Agent({ provider: entry.provider, model: entry.model, system: SUMMARIZER_SYSTEM }),
      ),
    );
    return agent;
  };
}

/** Convenience for non-interactive scripts: default entry + a ready agent. */
export function buildAgent(options: AgentFactoryOptions = {}) {
  const catalog = buildCatalog();
  const entry = defaultEntry(catalog);
  const createAgent = makeAgentFactory(options);
  return {
    agent: createAgent(entry),
    catalog,
    entry,
    createAgent,
    model: entry.model,
    providerLabel: entry.providerLabel,
  };
}
