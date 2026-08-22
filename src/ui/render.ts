import type { ActionResult } from "@fifthrevision/axle/ui";
import { theme } from "./theme.js";

export type ActionStatus = "pending" | "running" | "complete" | "cancelled" | "error";

/** The one marker every step renders with: thinking, tools, sub-agents. */
export const DOT = "●";

/**
 * Blue while a step is live, white once it has landed. The two failure states
 * keep their own colour — a cancelled or failed step reads as neither.
 */
export const DOT_COLOR: Record<ActionStatus, string> = {
  pending: theme.primary,
  running: theme.primary,
  complete: theme.settled,
  cancelled: theme.warning,
  error: theme.danger,
};

export function oneLineParams(params: Record<string, unknown>): string {
  const parts = Object.entries(params).map(([k, v]) => {
    let value: string;
    if (typeof v === "string") value = v;
    else value = JSON.stringify(v);
    // Collapse newlines and runs of whitespace: a bash command or file body
    // would otherwise break the row across lines before truncation can clip it.
    value = value.replace(/\s+/g, " ").trim();
    return `${k}: ${value}`;
  });
  return parts.join(", ");
}

export function resultToText(result: ActionResult | undefined): {
  text: string;
  tone: "muted" | "error";
} {
  if (!result) return { text: "", tone: "muted" };
  if (result.type === "in-progress") return { text: result.content, tone: "muted" };
  if (result.type === "error")
    return { text: `${result.error.type}: ${result.error.message}`, tone: "error" };
  const content = result.content;
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  return { text, tone: "muted" };
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function clampLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  const shown = lines.slice(0, maxLines).join("\n");
  return `${shown}\n… (${lines.length - maxLines} more lines)`;
}

/**
 * Show the *tail* of a growing string (the most recent lines), with a leading
 * indicator when content was elided.
 *
 * This is the counterpart to `clampLines` for **streaming** content: rather
 * than keeping the head and hiding the rest (which would freeze the visible
 * text at the start), it keeps the tail — the part still being written — so the
 * user sees live output. Used for the active streaming turn's text part so the
 * live region (everything below `<Static>`) never grows taller than the
 * terminal viewport. Ink falls back to `clearTerminal` (a full screen +
 * scrollback wipe + rewrite) when the live region exceeds the viewport, which
 * is the source of the flashing/jitter on long turns.
 */
export function tailLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  const shown = lines.slice(lines.length - maxLines).join("\n");
  return `… (${lines.length - maxLines} earlier lines)\n${shown}`;
}
