import { globSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { ExecutableTool } from "@fifthrevision/axle";

const MAX_MATCHES = 200;

const schema = z.object({
  pattern: z.string().describe("Regular expression to search for (JavaScript regex syntax)."),
  glob: z
    .string()
    .optional()
    .describe("File glob to search within. Defaults to '**/*'."),
  ignore_case: z.boolean().optional().describe("Case-insensitive match."),
});

export const grepTool: ExecutableTool<typeof schema> = {
  name: "grep",
  description:
    "Search file contents for a regular expression, returning file:line:text matches. Skips node_modules and .git.",
  schema,
  summarize: ({ pattern, glob }) => (glob ? `${pattern} in ${glob}` : pattern),
  async execute({ pattern, glob, ignore_case }, ctx) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, ignore_case ? "i" : undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid regex: ${message}`);
    }

    const files = globSync(glob ?? "**/*", {
      cwd: process.cwd(),
      exclude: (p) => p.includes("node_modules") || p.includes(".git"),
    }).sort();

    const results: string[] = [];
    for (const rel of files) {
      if (ctx.signal.aborted) break;
      const abs = resolve(process.cwd(), rel);
      try {
        const info = await stat(abs);
        if (!info.isFile() || info.size > 2_000_000) continue;
        const content = await readFile(abs, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            results.push(`${rel}:${i + 1}:${lines[i].trim()}`);
            if (results.length >= MAX_MATCHES) break;
          }
        }
      } catch {
        continue;
      }
      if (results.length >= MAX_MATCHES) break;
    }

    if (results.length === 0) return `No matches for /${pattern}/.`;
    const truncated = results.length >= MAX_MATCHES ? "\n… (truncated at 200 matches)" : "";
    return results.join("\n") + truncated;
  },
};
