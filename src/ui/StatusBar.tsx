import { Box } from "ink";
import React from "react";
import type { ContextUsage } from "@fifthrevision/axle";
import type { ModelEntry } from "../models.js";
import type { DisplayMode } from "./display.js";
import { ThemeText } from "./ThemeText.js";
import { theme, useTheme } from "./theme.js";
import { formatTokens } from "./render.js";

export interface StatusBarProps {
  entry: ModelEntry;
  context: ContextUsage | null;
  sessionUsage: { in: number; out: number };
  display?: DisplayMode;
}

export const StatusBar = React.memo(function StatusBar({ entry, context, sessionUsage, display = "verbose" }: StatusBarProps) {
  useTheme();
  const ctxText = context
    ? context.limit
      ? `ctx ${formatTokens(context.total)}/${formatTokens(context.limit)} (${Math.round(
          (context.total / context.limit) * 100,
        )}%)`
      : `ctx ~${formatTokens(context.total)} tok`
    : null;

  return (
    <Box marginTop={1} flexWrap="wrap">
      <ThemeText token={theme.faint}>
        {entry.providerLabel} · {entry.model}
      </ThemeText>
      {ctxText ? (
        <ThemeText token={theme.faint}>
          {"   "}
          {ctxText}
        </ThemeText>
      ) : null}
      <ThemeText token={theme.faint}>
        {"   "}session ↑{formatTokens(sessionUsage.in)} ↓{formatTokens(sessionUsage.out)}
      </ThemeText>
      {display !== "verbose" ? (
        <ThemeText token={theme.faint}>
          {"   "}display:{display}
        </ThemeText>
      ) : null}
    </Box>
  );
});
