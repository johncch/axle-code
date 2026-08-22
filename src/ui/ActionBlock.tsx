import { Box, Text } from "ink";
import React from "react";
import type { ActionPart } from "@fifthrevision/axle/ui";
import { TurnView } from "./TurnView.js";
import { DOT, DOT_COLOR, oneLineParams, resultToText, tailLines } from "./render.js";
import { theme } from "./theme.js";

const MAX_RESULT_LINES = 10;

function actionLabel(part: ActionPart): { name: string; detailText: string } {
  switch (part.kind) {
    case "tool":
      return {
        name: part.detail.name,
        detailText: part.detail.pendingArgs
          ? part.detail.pendingArgs
          : oneLineParams(part.detail.parameters),
      };
    case "agent":
      return { name: part.detail.name, detailText: "" };
    case "provider-tool":
      return { name: part.detail.name, detailText: "" };
  }
}

export const ActionBlock = React.memo(function ActionBlock({ part }: { part: ActionPart }) {
  const status = part.status;
  const { name, detailText } = actionLabel(part);
  const { text, tone } = resultToText(part.detail.result);
  const children = part.kind === "agent" ? part.detail.children : undefined;

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* One row, always: the params take the leftover width and clip at the
          right edge rather than wrapping the call across lines. Gaps are
          margins, not spaces inside the Texts — a space in a shrinkable Text
          is the first thing flex drops when the row overflows. */}
      <Box flexWrap="nowrap">
        <Box flexShrink={0}>
          <Text color={DOT_COLOR[status]}>{DOT}</Text>
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Text bold color={theme.tool}>
            {name}
          </Text>
        </Box>
        {detailText ? (
          <Box flexGrow={1} flexShrink={1} marginLeft={1}>
            <Text wrap="truncate-end">{detailText}</Text>
          </Box>
        ) : null}
      </Box>

      {children && children.length > 0 ? (
        <Box
          flexDirection="column"
          marginLeft={2}
          borderStyle="round"
          borderColor={theme.tool}
          paddingLeft={1}
        >
          {children.map((child) => (
            <TurnView key={child.id} turn={child} nested />
          ))}
        </Box>
      ) : null}

      {text ? (
        <Box
          marginLeft={2}
          borderStyle="round"
          borderColor={theme.muted}
          paddingLeft={1}
          paddingRight={1}
          flexDirection="column"
        >
          {/* Render one line per <Text> so `truncate-end` clips each line to
              the box's available width instead of collapsing the whole result
              into a single truncated line (which is what a single multi-line
              <Text wrap="truncate-end"> would do). */}
          {tailLines(text, MAX_RESULT_LINES).split("\n").map((line, index) => (
            // A single space keeps blank lines from collapsing (Ink skips
            // empty text nodes), preserving the result's vertical shape.
            <Text key={index} color={tone === "error" ? theme.danger : undefined} wrap="truncate-end">
              {line || " "}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
});
