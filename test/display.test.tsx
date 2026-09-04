import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import type { Turn } from "@fifthrevision/axle/ui";
import { TurnView } from "../src/ui/TurnView.js";
import { estimateTurnHeight } from "../src/ui/turnHeights.js";
import { parseDisplayMode } from "../src/ui/display.js";

function agentTurn(partial: Partial<Turn> & Pick<Turn, "id">): Turn {
  return { owner: "agent", parts: [], status: "complete", ...partial };
}

describe("parseDisplayMode", () => {
  it("accepts verbose/succinct case-insensitively", () => {
    expect(parseDisplayMode("verbose")).toBe("verbose");
    expect(parseDisplayMode("SUCCINCT")).toBe("succinct");
    expect(parseDisplayMode("  succinct ")).toBe("succinct");
  });

  it("rejects anything else", () => {
    expect(parseDisplayMode("")).toBeNull();
    expect(parseDisplayMode("compact")).toBeNull();
  });
});

describe("succinct rendering", () => {
  const rich = agentTurn({
    id: "rich",
    parts: [
      { id: "th", type: "thinking", text: "chain of thought body" },
      {
        id: "tool",
        type: "action",
        kind: "tool",
        status: "complete",
        detail: {
          name: "read-file",
          parameters: { path: "src/index.ts" },
          result: { type: "success", content: "line1\nline2\nline3" },
        },
      },
      { id: "tx", type: "text", text: "done" },
    ],
  });

  it("verbose keeps boxes; succinct collapses them", () => {
    const verbose = render(<TurnView turn={rich} display="verbose" />).lastFrame() ?? "";
    expect(verbose).toContain("chain of thought body");
    expect(verbose).toContain("line1");

    const succinct = render(<TurnView turn={rich} display="succinct" />).lastFrame() ?? "";
    // Label rows survive…
    expect(succinct).toContain("thinking");
    expect(succinct).toContain("read-file");
    expect(succinct).toContain("done");
    // …but boxed detail collapses.
    expect(succinct).not.toContain("chain of thought body");
    expect(succinct).not.toContain("line1");
  });

  it("verbose is the default", () => {
    const frame = render(<TurnView turn={rich} />).lastFrame() ?? "";
    expect(frame).toContain("chain of thought body");
  });

  it("succinct collapses sub-agent children to a count row", () => {
    const withKids = agentTurn({
      id: "parent",
      parts: [
        {
          id: "sub",
          type: "action",
          kind: "agent",
          status: "complete",
          detail: {
            name: "explore",
            children: [
              agentTurn({
                id: "child",
                parts: [{ id: "ct", type: "text", text: "child secret body" }],
              }),
            ],
          },
        },
      ],
    });
    const succinct = render(<TurnView turn={withKids} display="succinct" />).lastFrame() ?? "";
    expect(succinct).toContain("explore");
    expect(succinct).toContain("1 sub-step");
    expect(succinct).not.toContain("child secret body");
  });

  it("succinct mirrors verbose for empty settled thinking (renders nothing)", () => {
    const empty = { id: "e", type: "thinking", text: "" } as const;
    const t = agentTurn({ id: "e", parts: [empty] });
    const succinct = render(<TurnView turn={t} display="succinct" />).lastFrame() ?? "";
    expect(succinct).not.toContain("thinking");
  });

  it("regression: an over-wide markdansi line must wrap, not truncate the block", () => {
    // markdansi wraps to width 98 under ink-testing-library (100 cols), but
    // overshoots by one on the line below (99 chars): under
    // wrap="truncate-end" that single line collapsed the whole block to one
    // truncated row. The text below is the verbatim source line from the
    // __current__.json transcript that triggered it.
    const src =
      "2. **Remount like resize does.** `App` keys turns as `${turn.id}@${columns}` to force re-measure on resize. " +
      "Add mode to that key (`...:${mode}`) so toggling re-mounts + re-measures the windowed turns. Same bounded re-render loop as resize, fine.";
    const t = agentTurn({ id: "overwide", parts: [{ id: "p", type: "text", text: src }] });
    const frame = render(<TurnView turn={t} />).lastFrame() ?? "";
    const lines = frame.split("\n");
    // The full sentence survives across wrapped rows — nothing truncated away.
    expect(frame).toContain("bounded re-render loop as resize, fine.");
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.some((l) => l.endsWith("…"))).toBe(false);
  });
});

describe("succinct height estimates", () => {
  it("a thinking part predicts margin + one header row", () => {
    const t = agentTurn({
      id: "h",
      parts: [{ id: "p", type: "thinking", text: "a\nb\nc\nd\ne\nf\ng\nh\ni\nj" }],
    });
    expect(estimateTurnHeight(t, 80, "succinct")).toBe(2);
    expect(estimateTurnHeight(t, 80, "verbose")).toBeGreaterThan(2);
  });

  it("a tool action with a result predicts margin + one label row", () => {
    const t = agentTurn({
      id: "a",
      parts: [
        {
          id: "p",
          type: "action",
          kind: "tool",
          status: "complete",
          detail: {
            name: "bash",
            parameters: { command: "ls" },
            result: { type: "success", content: "a\nb\nc" },
          },
        },
      ],
    });
    expect(estimateTurnHeight(t, 80, "succinct")).toBe(2);
  });

  it("agent text still wraps in succinct mode", () => {
    const t = agentTurn({
      id: "w",
      parts: [{ id: "p", type: "text", text: "word ".repeat(200).trim() }],
    });
    expect(estimateTurnHeight(t, 80, "succinct")).toBe(estimateTurnHeight(t, 80, "verbose"));
    expect(estimateTurnHeight(t, 80, "succinct")).toBeGreaterThan(2);
  });
});
