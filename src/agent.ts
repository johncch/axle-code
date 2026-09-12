import { Agent, PromptCompactor } from "@fifthrevision/axle";
import type { AgentSession, ExecutableTool, ProviderTool } from "@fifthrevision/axle";
import { buildCatalog, defaultEntry, type ModelEntry } from "./models.js";

const SYSTEM_PROMPT = `You are axle-code, a terminal coding assistant.

You help the user read, write, and modify code in their working directory. When
a task requires inspecting or changing files, use the provided tools rather than
guessing. Prefer small, verifiable steps. Keep prose concise; let tool results
speak for themselves.

When a question involves information beyond the local codebase — recent library
versions, API docs, current behavior of a dependency, or anything time-sensitive
— use web search to ground your answer in current sources.`;

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
 * Auto-compaction threshold. Before each turn the engine estimates context
 * usage; once it crosses this the {@link PromptCompactor} runs. Since Axle
 * 0.31 the compaction sizes itself from the threshold: the summary targets
 * the library default of 1000 words, and recent user messages are kept
 * verbatim up to {@link COMPACTION_APPENDIX_TOKENS}. Well below any modern
 * model's window, so a session can continue indefinitely without hitting a
 * provider limit.
 */
const COMPACTION_THRESHOLD_TOKENS = 100_000;
/** Token budget for the recent user messages kept verbatim after a compaction. */
const COMPACTION_APPENDIX_TOKENS = 10_000;
/** Provider-managed web search. */
const WEB_SEARCH_PROVIDER_TOOL: ProviderTool = { type: "provider", name: "web_search" };

// OpenRouter's server-tool pipeline buffers reasoning: with a provider tool
// attached it ships the whole chain of thought as one chunk instead of
// streaming `thinking:delta`, so thinking only appears once it is finished.
const WEB_SEARCH_ENABLED = false;

export interface AgentFactoryOptions {
  tools?: ExecutableTool[];
  system?: string;
  /**
   * Auto-compaction tuning, from user settings. `threshold` is the size
   * at which compaction triggers before a turn. Omit to use the default.
   */
  compaction?: { threshold?: number };
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
  const thresholdTokens =
    options.compaction?.threshold ?? COMPACTION_THRESHOLD_TOKENS;
  const createAgent = (entry: ModelEntry, session?: AgentSession): Agent => {
    if (!entry.provider) {
      throw new Error(`${entry.label} is unavailable — set ${entry.keyEnv}.`);
    }
    const provider = entry.provider;
    const compactor = new PromptCompactor({
      provider,
      model: entry.model,
      prompt: COMPACTION_PROMPT,
      thresholdTokens,
      // 0.31 sizing: the summary targets its 1000-word default (omitted), and
      // recent user messages get an explicit token budget. Set explicitly so
      // a user-raised threshold doesn't silently scale the appendix with it
      // (the library default would be thresholdTokens / 10).
      appendixTokens: COMPACTION_APPENDIX_TOKENS,
    });
    const agent = new Agent(
      {
        provider,
        model: entry.model,
        system,
        tools,
        ...(WEB_SEARCH_ENABLED ? { providerTools: [WEB_SEARCH_PROVIDER_TOOL] } : {}),
      },
      session,
    );
    agent.setCompaction({
      shouldCompactOnTrigger: compactor.shouldCompactOnTrigger,
      compact: compactor.compact,
      triggers: { beforeTurn: true },
    });
    return agent;
  };
  return createAgent;
}

/** Convenience for non-interactive scripts: default entry + a ready agent. */
export function buildAgent(options: AgentFactoryOptions = {}) {
  const { entries: catalog } = buildCatalog();
  const { entry } = defaultEntry(catalog);
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
