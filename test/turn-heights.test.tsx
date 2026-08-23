import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import type { Turn } from "@fifthrevision/axle/ui";
import { MeasuredTurn } from "../src/ui/MeasuredTurn.js";
import { TurnHeightTable, estimateTurnHeight } from "../src/ui/turnHeights.js";

function turn(partial: Partial<Turn> & Pick<Turn, "id">): Turn {
  return {
    owner: "agent",
    parts: [],
    status: "complete",
    ...partial,
  };
}

describe("TurnHeightTable", () => {
  it("seeds unmeasured turns with predictions and reports totals", () => {
    const table = new TurnHeightTable();
    const turns: Turn[] = [
      turn({ id: "a" }),
      turn({ id: "b" }),
      turn({ id: "c" }),
    ];

    table.reindex(turns, 80);

    expect(table.totalHeight).toBeGreaterThan(0);
    // Prefix sums are monotonic and cover every turn.
    expect(table.endOffset(2)).toBe(table.totalHeight);
    expect(table.endOffset(0)).toBeLessThan(table.endOffset(1));
  });

  it("measured heights overwrite predictions", () => {
    const table = new TurnHeightTable();
    table.reindex([turn({ id: "x" })], 80);
    const predicted = table.totalHeight;

    expect(table.set("x", 80, 42)).toBe(true);
    table.reindex([turn({ id: "x" })], 80);
    expect(table.totalHeight).toBe(42);
    expect(table.totalHeight).not.toBe(predicted);
  });

  it("set() is change-gated on both width and height", () => {
    const table = new TurnHeightTable();
    expect(table.set("x", 80, 10)).toBe(true);
    expect(table.set("x", 80, 10)).toBe(false); // same → no-op
    expect(table.set("x", 100, 10)).toBe(true); // width changed → changed
  });

  it("indexOfOffset lands inside the turn covering the offset", () => {
    const table = new TurnHeightTable();
    table.set("a", 80, 5);
    table.set("b", 80, 20);
    table.set("c", 80, 1);
    table.reindex([turn({ id: "a" }), turn({ id: "b" }), turn({ id: "c" })], 80);

    expect(table.indexOfOffset(0)).toBe(0);
    expect(table.indexOfOffset(4)).toBe(0); // inside a
    expect(table.indexOfOffset(6)).toBe(1); // inside b
    expect(table.indexOfOffset(25)).toBe(2); // inside c
    expect(table.endIndexOfOffset(3)).toBe(1); // only a starts before row 3
    expect(table.endIndexOfOffset(30)).toBe(3); // everything
  });
});

describe("MeasuredTurn", () => {
  const collect = (table: TurnHeightTable) => (id: string, w: number, h: number) => {
    table.set(id, w, h);
  };

  it("reports exact height into the table on mount", async () => {
    const table = new TurnHeightTable();
    const t = turn({
      id: "m",
      parts: [
        { id: "t", type: "text", text: ["line one", "line two", "line three"].join("\n") },
      ],
    });

    const instance = render(<MeasuredTurn turn={t} onMeasure={collect(table)} />);
    // Assert against what actually rendered rather than a hardcoded row count,
    // so TurnView's styling can change without breaking the wiring test.
    const rendered = instance.lastFrame()!.split("\n").length;
    instance.unmount();

    expect(table.get("m")).toBe(rendered + 1); // + inter-turn gap
  });

  it("skips reporting while the turn is still streaming", async () => {
    const table = new TurnHeightTable();
    const t = turn({
      id: "s",
      status: "streaming",
      parts: [{ id: "t", type: "text", text: "partial" }],
    });

    const instance = render(<MeasuredTurn turn={t} onMeasure={collect(table)} />);
    instance.unmount();

    expect(table.get("s")).toBeUndefined();
  });

  it("re-measures a turn once it settles", async () => {
    const table = new TurnHeightTable();
    const streaming = turn({
      id: "r",
      status: "streaming",
      parts: [{ id: "t", type: "text", text: "one\ntwo" }],
    });

    const instance = render(<MeasuredTurn turn={streaming} onMeasure={collect(table)} />);
    expect(table.get("r")).toBeUndefined();

    instance.rerender(
      <MeasuredTurn turn={{ ...streaming, status: "complete" }} onMeasure={collect(table)} />,
    );
    const rendered = instance.lastFrame()!.split("\n").length;
    instance.unmount();

    expect(table.get("r")).toBe(rendered + 1);
  });
});

describe("estimateTurnHeight", () => {
  it("overestimates wrapped user text rather than underestimating", () => {
    const long = turn({
      id: "u",
      owner: "user",
      parts: [{ id: "p", type: "text", text: "word ".repeat(200).trim() }],
    });
    // 1000 chars at ~76 usable columns must predict more than one row.
    expect(estimateTurnHeight(long, 80)).toBeGreaterThan(10);
  });
});
