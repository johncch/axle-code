// The restart protocol: sentinel recognition, plus a drift-guard asserting the
// bin's inline copy of the exit code still matches src/restart.ts (the bin is
// plain .mjs — it runs before the tsx loader exists — so it can't import it).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRestartRequest, RESTART_EXIT_CODE, RESTART_SENTINEL } from "../src/restart.js";

describe("restart sentinel", () => {
  it("recognises the sentinel and nothing else", () => {
    expect(isRestartRequest(RESTART_SENTINEL)).toBe(true);
    expect(isRestartRequest(undefined)).toBe(false);
    expect(isRestartRequest(null)).toBe(false);
    expect(isRestartRequest("quit")).toBe(false);
    expect(isRestartRequest(75)).toBe(false);
  });
});

describe("bin/axle-code.mjs stays in sync with src/restart.ts", () => {
  const bin = readFileSync(new URL("../bin/axle-code.mjs", import.meta.url), "utf-8");

  it("uses the same RESTART_EXIT_CODE", () => {
    expect(bin).toContain(`const RESTART_EXIT_CODE = ${RESTART_EXIT_CODE};`);
  });
});
