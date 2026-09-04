import { Box, measureElement, type DOMElement } from "ink";
import React, { useEffect, useRef } from "react";
import type { Turn } from "@fifthrevision/axle/ui";
import type { DisplayMode } from "./display.js";
import { TurnView } from "./TurnView.js";

/**
 * Gap rendered *between* turns: every top-level turn opens with a blank line
 * (`marginTop={1}` on its parts / user-turn Box). That margin collapses at the
 * top of the measured subtree, so it's added back when reporting.
 */
const INTER_TURN_GAP = 1;

/**
 * Mount-time height measurement for a transcript entry.
 *
 * Wraps a top-level TurnView in a plain column Box and hands `measureElement`'s
 * exact row count to the caller, which owns the height table. Measured values
 * win over the predictor for the width *and display mode* they were taken
 * at — the caller keys this component on both, so a resize or a /display
 * toggle remounts it and it re-measures instead of reusing a stale value.
 *
 * Reporting is gated on turn status: a finished turn is immutable, so its
 * measurement is reported once and never again. A streaming turn's height
 * churns every flush — reporting each change would re-render the app at
 * token rate, defeating the coalescing in useAgent. Instead the streaming
 * turn stays mounted (window selection always includes it) and its exact
 * height lands in the table when it settles.
 */
export const MeasuredTurn = React.memo(function MeasuredTurn({
  turn,
  display = "verbose",
  onMeasure,
}: {
  turn: Turn;
  display?: DisplayMode;
  onMeasure: (turnId: string, width: number, height: number, display: DisplayMode) => void;
}) {
  const ref = useRef<DOMElement>(null);
  const settled = turn.status !== "streaming";

  useEffect(() => {
    if (!ref.current || !settled) return;
    const { width, height } = measureElement(ref.current);
    onMeasure(turn.id, width, height + INTER_TURN_GAP, display);
  }, [turn, settled, display, onMeasure]);

  return (
    <Box ref={ref} flexDirection="column" flexShrink={0}>
      <TurnView turn={turn} display={display} />
    </Box>
  );
});
