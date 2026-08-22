import { Box, Text } from "ink";
import React from "react";
import type { Turn, TurnPart } from "@fifthrevision/axle/ui";
import { ActionBlock } from "./ActionBlock.js";
import { Markdown } from "./Markdown.js";
import { ThemeText } from "./ThemeText.js";
import { theme } from "./theme.js";
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

export const PartView = React.memo(function PartView({
  part,
  active = false,
}: {
  part: TurnPart;
  /** The live tail of a streaming turn — drives the dot's blue/white. */
  active?: boolean;
}) {
  switch (part.type) {
    case "text":
      // Dot at column 0 like every other part, with the text itself starting
      // at column 2 (dot + space). The inner Box is what keeps wrapped lines
      // aligned under the first character instead of running back to column 0
      // — same trick as the user prompt row — and Markdown already wraps to
      // `columns - 2`, which matches this inset exactly.
      return (
        <Box marginTop={1}>
          <Text color={active ? theme.primary : theme.settled}>{DOT} </Text>
          <Box flexGrow={1}>
            <Markdown>{part.text}</Markdown>
          </Box>
        </Box>
      );
    case "thinking":
      if (part.redacted) return <ThemeText token={theme.faint}>[thinking redacted]</ThemeText>;
      return part.text ? (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color={active ? theme.primary : theme.settled}>{DOT} </Text>
            <Text bold dimColor>
              thinking
            </Text>
          </Box>
          <Box
            marginLeft={2}
            borderStyle="round"
            borderColor={theme.muted}
            paddingLeft={1}
            paddingRight={1}
          >
            <ThemeText token={theme.faint}>{tailLines(part.text, 8)}</ThemeText>
          </Box>
        </Box>
      ) : null;
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
// re-rendering on every streaming delta of the *active* turn.
//
// Turns render in full — no streaming clamps. Keeping the live region within
// the terminal viewport is the transcript flusher's job (see transcript.tsx):
// finalized parts and completed lines of the in-flight text part move to
// <Static> incrementally, so only the actively-changing tail renders live.
function TurnViewImpl({ turn, nested = false }: { turn: Turn; nested?: boolean }) {
  // A user turn is its text, behind the same caret the prompt uses. The inner
  // Box is what makes wrapped lines align under the first character instead of
  // running back to column 0.
  if (turn.owner === "user" && !nested) {
    const typed = turn.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
    return (
      <Box marginTop={1}>
        <ThemeText token={theme.primary}>❯ </ThemeText>
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
          />
        ))}
        <TurnFooter turn={turn} />
      </Box>
    </Box>
  );
}

export const TurnView = React.memo(TurnViewImpl);
