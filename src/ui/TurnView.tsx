import { Box, Text } from "ink";
import React from "react";
import type { Turn, TurnPart } from "@fifthrevision/axle/ui";
import { ActionBlock } from "./ActionBlock.js";
import type { DisplayMode } from "./display.js";
import { Markdown } from "./Markdown.js";
import { ThemeText } from "./ThemeText.js";
import { theme, useTheme } from "./theme.js";
import { DOT, tailLines } from "./render.js";

/**
 * Width of the compaction progress bar (in characters, excluding brackets).
 * Picked to be readable in typical 80-col terminals without dominating the row.
 */
const COMPACTION_BAR_WIDTH = 20;

function CompactionProgress({ summary, progress }: { summary?: string; progress?: number }) {
  const pct = progress != null ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : null;
  const label = summary ?? "compacting context";
  if (pct != null) {
    const filled = Math.round((pct / 100) * COMPACTION_BAR_WIDTH);
    const empty = COMPACTION_BAR_WIDTH - filled;
    const bar = `${"█".repeat(filled)}${"░".repeat(empty)}`;
    return <ThemeText token={theme.warning}>⤺ {label} [{bar}] {pct}%</ThemeText>;
  }
  return <ThemeText token={theme.warning}>⤺ {label}…</ThemeText>;
}

function ThinkingHeading({ redacted }: { redacted?: boolean }) {
  return (
    <>
      <Text bold>Thinking</Text>
      {redacted ? <Text dimColor> Redacted</Text> : null}
    </>
  );
}

// The part dot: bright while its part is live, and bright on the turn's
// final text part (the answer); every other landed dot dims, so a finished
// transcript reads as a quiet column of dots with one highlight on the
// message. The faint attribute composes with the dot's colour.
function PartDot({ active, final }: { active?: boolean; final?: boolean }) {
  return (
    <Text color={active ? theme.primary : theme.settled} dimColor={!(active || final)}>
      {DOT}{" "}
    </Text>
  );
}

export const PartView = React.memo(function PartView({
  part,
  active = false,
  final = false,
  display = "verbose",
}: {
  part: TurnPart;
  /** The live tail of a streaming turn — drives the dot's blue/white. */
  active?: boolean;
  /** The turn's final text part: its dot stays bright while every other
   * landed dot dims, so the transcript's one highlight marks the answer. */
  final?: boolean;
  /** Succinct collapses every boxed detail into its one-line label row. */
  display?: DisplayMode;
}) {
  // Re-render on live theme changes — memo'd otherwise.
  useTheme();
  // Succinct mode is the activity log: thinking keeps its header row, actions
  // keep their one-line label row (rendered by ActionBlock), and everything
  // else renders as it does in verbose. User text and agent text never
  // collapse — they *are* the transcript.
  if (display === "succinct") {
    if (part.type === "thinking") {
      if (part.redacted && !part.summary)
        return (
          <Box marginTop={1}>
            <PartDot active={active} />
            <ThinkingHeading redacted />
          </Box>
        );
      // Match verbose: a part with neither summary nor text renders nothing
      // once settled; while live it still holds its header row as a placeholder.
      if (!part.summary && !part.text && !active) return null;
      return (
        <Box marginTop={1}>
          <PartDot active={active} />
          <ThinkingHeading redacted={part.redacted} />
        </Box>
      );
    }
    if (part.type === "action") {
      return <ActionBlock part={part} display={display} />;
    }
  }
  switch (part.type) {
    case "text":
      // Dot at column 0 like every other part, with the text itself starting
      // at column 2 (dot + space). The inner Box is what keeps wrapped lines
      // aligned under the first character instead of running back to column 0
      // — same trick as the user prompt row — and Markdown already wraps to
      // `columns - 2`, which matches this inset exactly.
      return (
        <Box marginTop={1}>
          <PartDot active={active} final={final} />
          <Box flexGrow={1}>
            <Markdown>{part.text}</Markdown>
          </Box>
        </Box>
      );
    case "thinking": {
      const body = part.summary || (!part.redacted ? part.text : "");
      if (part.redacted && !body)
        return (
          <Box flexDirection="column" marginTop={1}>
            <Box>
              <PartDot active={active} />
              <ThinkingHeading redacted />
            </Box>
          </Box>
        );
      // Providers disagree on which field carries reasoning: some stream raw
      // chain of thought into `text`, others only ever populate `summary`.
      // Summary wins when both arrive — it's the readable form of the same
      // reasoning. A part with neither still renders while the turn is live,
      // so a slow first delta shows a box instead of nothing.
      if (!body && !active) return null;
      return (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <PartDot active={active} />
            <ThinkingHeading redacted={part.redacted} />
          </Box>
          {/* The rule hangs at column 0 so it lines up with the part square;
              paddingLeft 1 puts the body one space in — same column as the
              label text above, so `│ text` mirrors `▪ text`. */}
          <Box
            borderStyle="round"
            borderTop={false}
            borderBottom={false}
            borderRight={false}
            borderColor={theme.muted}
            paddingLeft={1}
          >
            <ThemeText token={theme.faint}>{body ? tailLines(body, 8) : "…"}</ThemeText>
          </Box>
        </Box>
      );
    }
    case "action":
      return <ActionBlock part={part} />;
    case "file":
      return <Text>📎 {part.file.name ?? "file"}</Text>;
    case "citation":
      return <Text>[citations: {part.citations.length}]</Text>;
    case "compaction":
      if (part.status === "running") {
        return <CompactionProgress summary={part.summary} progress={part.progress} />;
      }
      if (part.status === "error") {
        return <ThemeText token={theme.danger}>⤺ compaction failed: {part.error}</ThemeText>;
      }
      return <ThemeText token={theme.warning}>⤺ context compacted{part.summary ? `: ${part.summary}` : ""}</ThemeText>;
    default:
      return null;
  }
});

// Only sub-agent turns still carry a header: at the top level the caret is the
// user's whole prefix, and the agent's own turns are unlabelled — their parts
// each announce themselves with a dot.
export function TurnHeader({ turn }: { turn: Turn }) {
  return (
    <ThemeText token={turn.owner === "user" ? theme.primary : theme.agent}>
      {turn.owner === "user" ? "↳ task" : "↳ sub-agent"}
    </ThemeText>
  );
}

export function TurnFooter({ turn }: { turn: Turn }) {
  if (turn.owner === "user") return null;
  if (turn.status === "error") {
    return (
      <ThemeText token={theme.danger}>
        {turn.error ? `[${turn.error.type} error: ${turn.error.message}]` : "[turn ended with error]"}
      </ThemeText>
    );
  }
  if (turn.status === "cancelled") return <ThemeText token={theme.warning}>[cancelled]</ThemeText>;
  return null;
}

// `TurnView` is memoized: a finished turn's `turn` object is referentially
// stable (the accumulator doesn't mutate it after turn:end), so it skips
// re-rendering on every streaming delta of the *active* turn. `display` is a
// prop (not context) precisely so toggling it busts the memo.
function TurnViewImpl({ turn, nested = false, display = "verbose" }: { turn: Turn; nested?: boolean; display?: DisplayMode }) {
  // Re-render on live theme changes — memo'd otherwise.
  useTheme();
  // A user turn is its text, behind the prompt's caret glyph — rendered in
  // plain foreground here so recorded rows read as quiet history; the live
  // prompt keeps the accent colour. The inner Box is what makes wrapped lines
  // align under the first character instead of running back to column 0.
  if (turn.owner === "user" && !nested) {
    const typed = turn.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
    return (
      <Box marginTop={1}>
        <Text>❯ </Text>
        <Box flexGrow={1}>
          <Text>{typed}</Text>
        </Box>
      </Box>
    );
  }

  // Agent turns are unwrapped: no header, no indent, so every dot sits at
  // column 0. Vertical spacing belongs to the parts, which each carry one
  // blank line above them — the turn adding its own would double it.
  const lastIndex = turn.parts.length - 1;
  return (
    <Box flexDirection="column">
      {nested ? <TurnHeader turn={turn} /> : null}
      <Box flexDirection="column" marginLeft={nested ? 2 : 0}>
        {turn.parts.map((part, index) => (
          <PartView
            key={part.id}
            part={part}
            active={turn.status === "streaming" && index === lastIndex}
            final={
              turn.owner === "agent" &&
              turn.status !== "streaming" &&
              index === lastIndex &&
              part.type === "text"
            }
            display={display}
          />
        ))}
        <TurnFooter turn={turn} />
      </Box>
    </Box>
  );
}

export const TurnView = React.memo(TurnViewImpl);
