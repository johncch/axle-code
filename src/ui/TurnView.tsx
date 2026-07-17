import { Box, Text } from "ink";
import React from "react";
import type { Turn, TurnPart } from "@fifthrevision/axle/ui";
import { ActionBlock } from "./ActionBlock.js";
import { clampLines } from "./render.js";

export const PartView = React.memo(function PartView({ part }: { part: TurnPart }) {
  switch (part.type) {
    case "text":
      return <Text>{part.text}</Text>;
    case "thinking":
      if (part.redacted) return <Text>💭 [thinking redacted]</Text>;
      return part.text ? (
        <Box flexDirection="column">
          <Text>💭 thinking</Text>
          <Text>
            {clampLines(part.text, 8)}
          </Text>
        </Box>
      ) : null;
    case "action":
      return <ActionBlock part={part} />;
    case "file":
      return <Text>📎 {part.file.name ?? "file"}</Text>;
    case "citation":
      return <Text>[citations: {part.citations.length}]</Text>;
    case "compaction":
      return <Text color="yellow">⤺ context compacted</Text>;
    default:
      return null;
  }
});

export function TurnHeader({ turn, nested = false }: { turn: Turn; nested?: boolean }) {
  const isUser = turn.owner === "user";
  const header = nested
    ? isUser
      ? "↳ task"
      : "↳ sub-agent"
    : isUser
      ? "❯ you"
      : "● axle-code";
  return (
    <Text bold={!nested} color={isUser ? "blue" : "green"}>
      {header}
    </Text>
  );
}

export function TurnFooter({ turn }: { turn: Turn }) {
  if (turn.owner === "user") return null;
  if (turn.status === "error") {
    return (
      <Text color="red">
        {turn.error ? `[${turn.error.type} error: ${turn.error.message}]` : "[turn ended with error]"}
      </Text>
    );
  }
  if (turn.status === "cancelled") return <Text color="yellow">[cancelled]</Text>;
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
  return (
    <Box flexDirection="column" marginTop={nested ? 0 : 1}>
      <TurnHeader turn={turn} nested={nested} />
      <Box flexDirection="column" marginLeft={2}>
        {turn.parts.map((part) => (
          <PartView key={part.id} part={part} />
        ))}
        <TurnFooter turn={turn} />
      </Box>
    </Box>
  );
}

export const TurnView = React.memo(TurnViewImpl);
