import { Agent } from "@fifthrevision/axle";
import type { AxleMessage, CompactionCallback } from "@fifthrevision/axle";

function messageText(message: AxleMessage): string {
  const content: unknown = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (part?.type === "text") return part.text ?? "";
        if (part?.type === "tool-call") return `[tool-call ${part.name}]`;
        if (part?.type === "thinking") return "";
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/**
 * A compaction policy that collapses the active conversation into a single
 * summary `user` message. Uses a throwaway summarizer agent, falling back to a
 * mechanical note if that fails. Returns null (skip) when there's little to do.
 */
export function createCompactionCallback(
  makeSummarizer: () => Agent,
  minMessages = 6,
): CompactionCallback {
  return async (state, ctx) => {
    if (state.messages.length < minMessages) return null;

    const transcript = state.messages
      .map((m) => `${m.role}: ${messageText(m).slice(0, 800)}`)
      .filter((line) => line.trim().length > 0)
      .join("\n");

    let summary = "";
    try {
      const res = await makeSummarizer().send(
        "Compress this coding-assistant transcript into a concise briefing that preserves " +
          "decisions made, files created/changed, key tool results, and any open tasks. " +
          "Use short bullet points.\n\n" +
          transcript,
        { signal: ctx.signal },
      ).final;
      if (res.ok) summary = res.response;
    } catch {
      // fall through to mechanical summary
    }

    if (!summary.trim()) {
      summary = `Earlier conversation (${state.messages.length} messages) could not be summarized automatically.`;
    }

    return [{ role: "user", content: `[Compacted earlier context]\n${summary}` }];
  };
}
