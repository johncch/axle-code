import { Box, Text } from "ink";
import React from "react";
import type { Turn, TurnPart } from "@fifthrevision/axle/ui";
import { ActionBlock } from "./ActionBlock.js";
import { clampLines } from "./render.js";

function PartView({ part }: { part: TurnPart }) {
  switch (part.type) {
    case "text":
      return <Text>{part.text}</Text>;
    case "thinking":
      if (part.redacted) return <Text color="gray">💭 [thinking redacted]</Text>;
      return part.text ? (
        <Box flexDirection="column">
          <Text color="gray">💭 thinking</Text>
          <Text color="gray" dimColor>
            {clampLines(part.text, 8)}
          </Text>
        </Box>
      ) : null;
    case "action":
      return <ActionBlock part={part} />;
    case "file":
      return <Text color="gray">📎 {part.file.name ?? "file"}</Text>;
    case "citation":
      return <Text color="gray">[citations: {part.citations.length}]</Text>;
    case "compaction":
      return <Text color="yellow">⤺ context compacted</Text>;
    default:
      return null;
  }
}

export function TurnView({ turn, nested = false }: { turn: Turn; nested?: boolean }) {
  const isUser = turn.owner === "user";
  const header = nested
    ? isUser
      ? "↳ task"
      : "↳ sub-agent"
    : isUser
      ? "❯ you"
      : "● axle-code";
  return (
    <Box flexDirection="column" marginTop={nested ? 0 : 1}>
      <Text bold={!nested} color={isUser ? "blue" : "green"} dimColor={nested}>
        {header}
      </Text>
      <Box flexDirection="column" marginLeft={2}>
        {turn.parts.map((part) => (
          <PartView key={part.id} part={part} />
        ))}
        {turn.status === "error" && !isUser ? (
          <Text color="red">[turn ended with error]</Text>
        ) : null}
        {turn.status === "cancelled" && !isUser ? (
          <Text color="yellow">[cancelled]</Text>
        ) : null}
      </Box>
    </Box>
  );
}
