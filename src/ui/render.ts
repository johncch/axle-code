import type { ActionResult } from "@fifthrevision/axle/ui";

export type ActionStatus = "pending" | "running" | "complete" | "cancelled" | "error";

export const STATUS_GLYPH: Record<ActionStatus, string> = {
  pending: "○",
  running: "◐",
  complete: "✔",
  cancelled: "⊘",
  error: "✖",
};

export const STATUS_COLOR: Record<ActionStatus, string> = {
  pending: "gray",
  running: "cyan",
  complete: "green",
  cancelled: "yellow",
  error: "red",
};

export function oneLineParams(params: Record<string, unknown>): string {
  const parts = Object.entries(params).map(([k, v]) => {
    let value: string;
    if (typeof v === "string") value = v;
    else value = JSON.stringify(v);
    if (value.length > 60) value = value.slice(0, 57) + "…";
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
