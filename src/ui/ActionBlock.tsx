import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React from "react";
import type { ActionPart } from "@fifthrevision/axle/ui";
import { TurnView } from "./TurnView.js";
import {
  STATUS_COLOR,
  STATUS_GLYPH,
  clampLines,
  oneLineParams,
  resultToText,
} from "./render.js";

const MAX_RESULT_LINES = 12;

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
      return { name: `🤖 ${part.detail.name}`, detailText: "" };
    case "provider-tool":
      return { name: part.detail.name, detailText: "" };
  }
}

export function ActionBlock({ part }: { part: ActionPart }) {
  const status = part.status;
  const { name, detailText } = actionLabel(part);
  const { text, tone } = resultToText(part.detail.result);
  const children = part.kind === "agent" ? part.detail.children : undefined;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Box marginRight={1}>
          {status === "running" ? (
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
          ) : (
            <Text color={STATUS_COLOR[status]}>{STATUS_GLYPH[status]}</Text>
          )}
        </Box>
        <Text bold color="magenta">
          {name}
        </Text>
        {detailText ? <Text color="gray"> {detailText}</Text> : null}
      </Box>

      {children && children.length > 0 ? (
        <Box
          flexDirection="column"
          marginLeft={2}
          borderStyle="round"
          borderColor="magenta"
          paddingLeft={1}
        >
          {children.map((child) => (
            <TurnView key={child.id} turn={child} nested />
          ))}
        </Box>
      ) : null}

      {text ? (
        <Box marginLeft={2} borderStyle="round" borderColor="gray" paddingLeft={1} paddingRight={1}>
          <Text color={tone === "error" ? "red" : "gray"}>{clampLines(text, MAX_RESULT_LINES)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
