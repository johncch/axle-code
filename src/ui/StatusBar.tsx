import { Box, Text } from "ink";
import React from "react";
import type { ContextUsage } from "@fifthrevision/axle";
import type { ModelEntry } from "../models.js";
import { formatTokens } from "./render.js";

export interface StatusBarProps {
  entry: ModelEntry;
  context: ContextUsage | null;
  sessionUsage: { in: number; out: number };
  hint: string;
}

export const StatusBar = React.memo(function StatusBar({ entry, context, sessionUsage, hint }: StatusBarProps) {
  const ctxText = context
    ? context.limit
      ? `ctx ${formatTokens(context.total)}/${formatTokens(context.limit)} (${Math.round(
          (context.total / context.limit) * 100,
        )}%)`
      : `ctx ~${formatTokens(context.total)} tok`
    : null;

  return (
    <Box marginTop={1} flexWrap="wrap">
      <Text dimColor>
        {entry.providerLabel} · {entry.model}
      </Text>
      {ctxText ? (
        <Text dimColor>
          {"   "}
          {ctxText}
        </Text>
      ) : null}
      <Text dimColor>
        {"   "}session ↑{formatTokens(sessionUsage.in)} ↓{formatTokens(sessionUsage.out)}
      </Text>
      <Text dimColor>
        {"   "}
        {hint}
      </Text>
    </Box>
  );
});
