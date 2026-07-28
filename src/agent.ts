import { Agent, PromptCompactor } from "@fifthrevision/axle";
import type { AgentSession, ExecutableTool } from "@fifthrevision/axle";
import { buildCatalog, defaultEntry, type ModelEntry } from "./models.js";

const SYSTEM_PROMPT = `You are axle-code, a terminal coding assistant.

You help the user read, write, and modify code in their working directory. When
a task requires inspecting or changing files, use the provided tools rather than
guessing. Prefer small, verifiable steps. Keep prose concise; let tool results
speak for themselves.`;

/**
 * Instruction handed to the summarizer that produces each compaction briefing.
 * Faithful to the original hand-rolled policy: decisions, file changes, key
 * tool results, and open tasks, as short bullets.
 */
const COMPACTION_PROMPT =
  "Compress this coding-assistant transcript into a concise briefing that preserves " +
  "decisions made, files created/changed, key tool results, and any open tasks. " +
  "Use short bullet points.";

/**
 * Auto-compaction thresholds. Before each turn the engine estimates context
 * usage; once it crosses `THRESHOLD_TOKENS` the {@link PromptCompactor} runs
 * and shrinks the active conversation toward `TARGET_TOKENS`, preserving the
 * most recent user messages verbatim. Well below any modern model's window, so
 * a session can continue indefinitely without hitting a provider limit.
 */
const COMPACTION_THRESHOLD_TOKENS = 100_000;
const COMPACTION_TARGET_TOKENS = 30_000;
/** Recent user messages kept verbatim after a compaction, for continuity. */
const COMPACTION_RECENT_USER_MESSAGES = 10;

export interface AgentFactoryOptions {
  tools?: ExecutableTool[];
  system?: string;
}

/**
 * Returns a factory that builds an Agent for any catalog entry, optionally
 * restoring a prior session so a model switch continues the same conversation.
 *
 * Each agent is configured with a {@link PromptCompactor} registered via
 * `setCompaction` with a `beforeTurn` trigger, so the conversation auto-compacts
 * as it grows and a session can run forever without overflowing the context
 * window. Manual `/compact` remains available via `agent.compact()`.
 */
export function makeAgentFactory(options: AgentFactoryOptions = {}) {
  const tools = options.tools ?? [];
  const system = options.system ?? SYSTEM_PROMPT;
  const createAgent = (entry: ModelEntry, session?: AgentSession): Agent => {
    if (!entry.provider) {
      throw new Error(`${entry.label} is unavailable — set ${entry.keyEnv}.`);
    }
    const provider = entry.provider;
    const compactor = new PromptCompactor({
      provider,
      model: entry.model,
      prompt: COMPACTION_PROMPT,
      thresholdTokens: COMPACTION_THRESHOLD_TOKENS,
      targetTokens: COMPACTION_TARGET_TOKENS,
      recentUserMessages: COMPACTION_RECENT_USER_MESSAGES,
    });
    const agent = new Agent({ provider, model: entry.model, system, tools }, session);
    agent.setCompaction({ compact: compactor.compact, triggers: { beforeTurn: true } });
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
