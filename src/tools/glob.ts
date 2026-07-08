import { globSync } from "node:fs";
import { z } from "zod";
import type { ExecutableTool } from "@fifthrevision/axle";

const MAX_RESULTS = 200;

const schema = z.object({
  pattern: z.string().describe("Glob pattern, e.g. 'src/**/*.ts'."),
});

export const globTool: ExecutableTool<typeof schema> = {
  name: "glob",
  description:
    "Find files matching a glob pattern, relative to the working directory. Skips node_modules and .git.",
  schema,
  summarize: ({ pattern }) => pattern,
  async execute({ pattern }) {
    const matches = globSync(pattern, {
      cwd: process.cwd(),
      exclude: (p) => p.includes("node_modules") || p.includes(".git"),
    }).sort();

    if (matches.length === 0) return `No files match ${pattern}.`;
    const shown = matches.slice(0, MAX_RESULTS);
    const suffix =
      matches.length > MAX_RESULTS ? `\n… ${matches.length - MAX_RESULTS} more (truncated)` : "";
    return shown.join("\n") + suffix;
  },
};
