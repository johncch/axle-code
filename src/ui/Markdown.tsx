import { Text, useStdout } from "ink";
import React, { useMemo } from "react";
import chalk from "chalk";
import { render as renderMarkdown } from "markdansi";

export const Markdown = React.memo(function Markdown({ children }: { children: string }) {
  const { stdout } = useStdout();
  // Match the terminal width so markdansi wraps where Ink would have. Text
  // parts live inside a 2-column turn indent; overestimating the width would
  // push wrapped lines past the viewport's right edge and clip them.
  const width = Math.max(20, (stdout?.columns ?? 80) - 2);
  const rendered = useMemo(
    // Pass `color` explicitly: markdansi's default is process.stdout.isTTY,
    // which misses Ink's own color detection (FORCE_COLOR, CI, etc.) — chalk
    // level is what Ink uses, so mirror it. Level 0 emits plain text, keeping
    // piped output and tests clean.
    // Trim the leading/trailing blank lines markdansi wraps the block in:
    // vertical rhythm is the caller's margin, so leaving them here would
    // double the gap on one side and not the other.
    () =>
      renderMarkdown(children, {
        width,
        color: chalk.level > 0,
        hyperlinks: false,
      })
        .replace(/^\n+/, "")
        .replace(/\n+$/, ""),
    [children, width],
  );
  // The output already carries ANSI styles and is pre-wrapped to the terminal
  // width — Ink's wrap= would re-wrap (and miscount ANSI sequences), so opt
  // out and print the lines as-is. The leading/trailing newlines markdansi
  // emits become the paragraph spacing between parts.
  return <Text wrap="truncate-end">{rendered}</Text>;
});
