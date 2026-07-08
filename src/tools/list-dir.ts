import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { ExecutableTool } from "@fifthrevision/axle";

const schema = z.object({
  path: z.string().optional().describe("Directory to list. Defaults to the working directory."),
});

export const listDirTool: ExecutableTool<typeof schema> = {
  name: "list_dir",
  description: "List the entries in a directory, marking subdirectories with a trailing slash.",
  schema,
  summarize: ({ path }) => path ?? ".",
  async execute({ path }) {
    const target = path ?? ".";
    const abs = resolve(process.cwd(), target);
    try {
      const entries = await readdir(abs, { withFileTypes: true });
      if (entries.length === 0) return `${target} is empty.`;
      return entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .join("\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to list "${target}": ${message}`);
    }
  },
};
