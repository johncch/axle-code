import { Text, useStdout } from "ink";
import React, { useMemo } from "react";
import chalk from "chalk";
import { highlightLine } from "./highlight.js";
import { render as renderMarkdown, type Theme, type ThemeName } from "markdansi";

// Two-tone markdown: white body text, one accent (cyan) for things worth
// pointing at (headings, inline code, list markers). Everything else is
// plain attributes — bold/italic/underline/dim — no per-element hues.
const accentTheme: Theme = {
  heading: { color: "white", bold: true },
  strong: { bold: true },
  emph: { italic: true },
  inlineCode: { color: "cyan" },
  blockCode: { color: "white" },
  code: { color: "white" },
  link: { underline: true },
  quote: { dim: true },
  hr: { dim: true },
  listMarker: { color: "cyan", bold: true },
  tableHeader: { color: "white", bold: true },
  tableCell: {},
};

// Escape hatch: AXLE_CODE_MARKDOWN_THEME=<name> picks one of markdansi's
// built-in themes instead ("monochrome" is pure attributes, zero color).
const builtinNames = ["default", "dim", "bright", "solarized", "monochrome", "contrast"];
const resolveTheme = (): ThemeName | Theme => {
  const requested = process.env.AXLE_CODE_MARKDOWN_THEME;
  return requested && builtinNames.includes(requested) ? (requested as ThemeName) : accentTheme;
};

export const Markdown = React.memo(function Markdown({ children }: { children: string }) {
  const { stdout } = useStdout();
  // Match the terminal width so markdansi wraps where Ink would have. Text
  // parts live inside a 2-column turn indent; overestimating the width would
  // push wrapped lines past the viewport's right edge and clip them.
  const width = Math.max(20, (stdout?.columns ?? 80) - 2);
  const theme = resolveTheme();
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
        theme,
        hyperlinks: false,
        // Fenced code blocks get highlight.js colors (via cli-highlight).
        // markdansi calls this per line and is ANSI-aware when it measures
        // and pads the block, so colored output can't skew the layout.
        // Fences whose language highlight.js doesn't know — and any block
        // that throws mid-parse — fall back to the plain string, which is
        // exactly how they render without a highlighter.
        highlighter: (code, lang) => highlightLine(code, lang),
      })
        .replace(/^\n+/, "")
        .replace(/\n+$/, ""),
    [children, width, theme],
  );
  // The output already carries ANSI styles and is pre-wrapped to the terminal
  // width — Ink must not truncate it. markdansi can overshoot the requested
  // width by a character on lines with unstyled-replaced spans (e.g. inline
  // code, which it renders without ANSI codes), and a single over-wide line
  // under wrap="truncate-end" collapses the *whole block* to one line: Ink
  // only applies textWrap when widestLine > maxWidth, and truncate-end keeps
  // just the first line plus an ellipsis. wrap="wrap" is the safe fallback —
  // normally a no-op (content already fits), and a genuine re-wrap of the odd
  // over-wide line otherwise.
  return <Text wrap="wrap">{rendered}</Text>;
});
