import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { ExecutableTool } from "@fifthrevision/axle";

const schema = z.object({
  path: z.string().describe("Path to the file to edit, relative to the working directory."),
  old_string: z.string().describe("Exact text to find. Must be unique unless replace_all is set."),
  new_string: z.string().describe("Text to replace it with."),
  replace_all: z.boolean().optional().describe("Replace every occurrence instead of requiring one."),
});

export const editFileTool: ExecutableTool<typeof schema> = {
  name: "edit_file",
  description:
    "Replace an exact string in a file. By default the target must appear exactly once; set replace_all to change every occurrence.",
  schema,
  summarize: ({ path }) => path,
  async execute({ path, old_string, new_string, replace_all }) {
    const abs = resolve(process.cwd(), path);
    let content: string;
    try {
      content = await readFile(abs, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read "${path}": ${message}`);
    }

    const occurrences = content.split(old_string).length - 1;
    if (occurrences === 0) {
      throw new Error(`old_string not found in "${path}".`);
    }
    if (occurrences > 1 && !replace_all) {
      throw new Error(
        `old_string appears ${occurrences} times in "${path}". Make it unique or set replace_all.`,
      );
    }

    const updated = replace_all
      ? content.split(old_string).join(new_string)
      : content.replace(old_string, new_string);

    await writeFile(abs, updated, "utf-8");
    return `Replaced ${replace_all ? occurrences : 1} occurrence${
      replace_all && occurrences > 1 ? "s" : ""
    } in ${path}`;
  },
};
