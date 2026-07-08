import type { ExecutableTool } from "@fifthrevision/axle";
import { bashTool } from "./bash.js";
import { editFileTool } from "./edit-file.js";
import { exploreTool } from "./explore.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { listDirTool } from "./list-dir.js";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";

export const codingTools: ExecutableTool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  globTool,
  grepTool,
  bashTool,
  exploreTool,
];

export {
  bashTool,
  editFileTool,
  globTool,
  grepTool,
  listDirTool,
  readFileTool,
  writeFileTool,
};
