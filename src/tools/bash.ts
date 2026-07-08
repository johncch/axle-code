import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import type { ExecutableTool } from "@fifthrevision/axle";

const MAX_OUTPUT = 100_000;

const schema = z.object({
  command: z.string().describe("Shell command to run in the working directory."),
  timeout_ms: z
    .number()
    .optional()
    .describe("Kill the command after this many milliseconds. Defaults to 120000."),
});

export const bashTool: ExecutableTool<typeof schema> = {
  name: "bash",
  description:
    "Run a shell command in the working directory and return its combined stdout/stderr and exit code. Output streams live as it is produced.",
  schema,
  summarize: ({ command }) => (command.length > 60 ? command.slice(0, 57) + "…" : command),
  execute({ command, timeout_ms }, ctx) {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(command, {
        cwd: process.cwd(),
        shell: true,
      });

      let output = "";
      let truncated = false;

      // Decode across chunk boundaries so a multi-byte UTF-8 character split
      // between two stdout reads is not mangled into replacement chars.
      const decoder = new StringDecoder("utf8");

      const collect = (chunk: Buffer) => {
        const text = decoder.write(chunk);
        if (text.length === 0) return;
        if (!truncated) {
          if (output.length + text.length > MAX_OUTPUT) {
            output += text.slice(0, MAX_OUTPUT - output.length);
            truncated = true;
          } else {
            output += text;
          }
        }
        // Stream progress to the UI (renders via action:progress events).
        ctx.emit(text);
      };

      child.stdout.on("data", collect);
      child.stderr.on("data", collect);

      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, timeout_ms ?? 120_000);

      const onAbort = () => child.kill("SIGKILL");
      ctx.signal.addEventListener("abort", onAbort, { once: true });

      child.on("error", (error) => {
        clearTimeout(timeout);
        ctx.signal.removeEventListener("abort", onAbort);
        rejectPromise(new Error(`Failed to run command: ${error.message}`));
      });

      child.on("close", (code, sig) => {
        clearTimeout(timeout);
        ctx.signal.removeEventListener("abort", onAbort);
        const tail = decoder.end();
        if (tail.length > 0 && !truncated) {
          output += tail;
          ctx.emit(tail);
        }
        const suffix = truncated ? "\n… (output truncated)" : "";
        const status =
          sig != null ? `\n[killed by signal ${sig}]` : `\n[exit code ${code ?? 0}]`;
        resolvePromise((output || "(no output)") + suffix + status);
      });
    });
  },
};
