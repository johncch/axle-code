import { Agent } from "@fifthrevision/axle";
import type { AgentSession, ExecutableTool } from "@fifthrevision/axle";
import { createCompactionCallback } from "./compaction.js";
import { buildCatalog, defaultEntry, type ModelEntry } from "./models.js";

const SUMMARIZER_SYSTEM =
  "You summarize coding-assistant conversations into concise, faithful briefings.";

/**
 * Minimum messages before compaction is worth running. Mirrors the default in
 * `createCompactionCallback`; kept here for documentation.
 */

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
 * A per-agent mutable holder for the optional compaction focus prompt.
 *
 * The Axle `agent.compact()` API only accepts a signal — there's no channel
 * to pass extra context to the `CompactionCallback`. We capture that holder
 * in the compaction callback's closure so a host can set the focus prompt
 * just before calling `agent.compact()`.
 */
export interface CompactionFocus {
  prompt?: string;
}

/**
 * Returns a factory that builds an Agent for any catalog entry, optionally
 * restoring a prior session so a model switch continues the same conversation.
 */
export function makeAgentFactory(options: AgentFactoryOptions = {}) {
  const tools = options.tools ?? [];
  const system = options.system ?? SYSTEM_PROMPT;
  const createAgent = (entry: ModelEntry, session?: AgentSession): Agent => {
    if (!entry.provider) {
      throw new Error(`${entry.label} is unavailable — set ${entry.keyEnv}.`);
    }
    const provider = entry.provider;
    const focus: CompactionFocus = {};
    const agent = new Agent({ provider, model: entry.model, system, tools }, session);
    agent.onCompaction(
      createCompactionCallback(
        () => new Agent({ provider, model: entry.model, system: SUMMARIZER_SYSTEM }),
        6,
        () => focus.prompt,
      ),
    );
    // Stash the focus holder on the agent (non-enumerable) so the host can
    // set the prompt before calling `agent.compact()`.
    Object.defineProperty(agent, "compactionFocus", {
      value: focus,
      writable: false,
      enumerable: false,
      configurable: false,
    });
    return agent;
  };
  return createAgent;
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

/**
 * Read the per-agent compaction focus holder set by `makeAgentFactory`.
 *
 * Hosts set `holder.prompt` before calling `agent.compact()` to steer the
 * summary toward a topic, then clear it afterward.
 */
export function getCompactionFocus(agent: Agent): CompactionFocus {
  const focus = (agent as Agent & { compactionFocus?: CompactionFocus }).compactionFocus;
  if (!focus) throw new Error("Agent has no compaction focus holder (built without makeAgentFactory).");
  return focus;
}
