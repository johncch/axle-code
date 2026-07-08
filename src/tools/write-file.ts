import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { ExecutableTool } from "@fifthrevision/axle";

const schema = z.object({
  path: z.string().describe("Path to write, relative to the working directory."),
  content: z.string().describe("Full file content to write."),
});

export const writeFileTool: ExecutableTool<typeof schema> = {
  name: "write_file",
  description:
    "Write content to a file, creating parent directories as needed. Overwrites any existing file.",
  schema,
  summarize: ({ path }) => path,
  async execute({ path, content }) {
    const abs = resolve(process.cwd(), path);
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf-8");
      const lines = content.split("\n").length;
      return `Wrote ${content.length} bytes (${lines} lines) to ${path}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write "${path}": ${message}`);
    }
  },
};
