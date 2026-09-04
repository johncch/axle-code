import { highlight, supportsLanguage } from "cli-highlight";

/**
 * File extension → highlight.js language name. Only extensions that map to a
 * language highlight.js actually knows are listed; anything else falls through
 * to plain text (which is the correct rendering for an unknown language).
 */
const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  pl: "perl",
  lua: "lua",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  sql: "sql",
  css: "css",
  html: "html",
  xml: "xml",
  md: "markdown",
};

/** Best-effort language for a file path, by extension. */
export function languageFromPath(path: string): string | undefined {
  const base = path.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined; // no extension (or dotfile like ".gitignore")
  const lang = EXTENSION_LANGUAGES[base.slice(dot + 1).toLowerCase()];
  return lang && supportsLanguage(lang) ? lang : undefined;
}

/**
 * Highlight one line of code, or return it untouched on any doubt: unknown
 * language, or a grammar that throws mid-parse (ignoreIllegals makes that
 * rare but not impossible). Falling back to the plain string is exactly how
 * the line rendered before highlighting existed, so failure is invisible.
 *
 * Per-line highlighting matches how both callers render — markdansi calls its
 * `highlighter` per line, and tool results render one <Text> per line. The
 * cost is that a construct spanning lines (a multi-line string) colors its
 * continuation as ordinary code; at terminal widths, wrapping forces the same
 * compromise inside markdansi anyway.
 */
export function highlightLine(line: string, lang: string | undefined): string {
  if (!lang || !supportsLanguage(lang)) return line;
  try {
    return highlight(line, { language: lang, ignoreIllegals: true });
  } catch {
    return line;
  }
}