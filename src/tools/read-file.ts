import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { ExecutableTool } from "@fifthrevision/axle";

const schema = z.object({
  path: z.string().describe("Path to the file to read, relative to the working directory."),
});

export const readFileTool: ExecutableTool<typeof schema> = {
  name: "read_file",
  description: "Read the full contents of a file from the working directory.",
  schema,
  summarize: ({ path }) => path,
  async execute({ path }) {
    const abs = resolve(process.cwd(), path);
    try {
      return await readFile(abs, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read "${path}": ${message}`);
    }
  },
};
