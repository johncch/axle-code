import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import type { ThinkingPart } from "@fifthrevision/axle/ui";
import { PartView } from "../src/ui/TurnView.js";

function renderPart(part: ThinkingPart, active = false) {
  const { lastFrame } = render(<PartView part={part} active={active} />);
  return lastFrame() ?? "";
}

describe("PartView thinking rendering", () => {
  it("renders raw-text thinking", () => {
    const frame = renderPart({ id: "p1", type: "thinking", text: "raw chain of thought" });
    expect(frame).toContain("thinking");
    expect(frame).toContain("raw chain of thought");
  });

  it("renders summary-only thinking (the old bug: these rendered nothing)", () => {
    const frame = renderPart({ id: "p2", type: "thinking", text: "", summary: "thought summary stream" });
    expect(frame).toContain("thinking");
    expect(frame).toContain("thought summary stream");
  });

  it("prefers summary over text when both are present", () => {
    const frame = renderPart({
      id: "p3",
      type: "thinking",
      text: "internal gibberish",
      summary: "clean summary",
    });
    expect(frame).toContain("clean summary");
    expect(frame).not.toContain("internal gibberish");
  });

  it("shows an empty-state frame before any delta arrives (ongoing thinking)", () => {
    const frame = renderPart({ id: "p4", type: "thinking", text: "" }, true);
    expect(frame).toContain("thinking");
    expect(frame).toContain("…");
  });
});
