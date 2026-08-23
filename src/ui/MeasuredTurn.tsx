import { Box, measureElement, type DOMElement } from "ink";
import React, { useEffect, useRef } from "react";
import type { Turn } from "@fifthrevision/axle/ui";
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
 * win over the predictor until the terminal is resized — the caller keys this
 * component on the column count, so a resize remounts it and it re-measures at
 * the new width.
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
  onMeasure,
}: {
  turn: Turn;
  onMeasure: (turnId: string, width: number, height: number) => void;
}) {
  const ref = useRef<DOMElement>(null);
  const settled = turn.status !== "streaming";

  useEffect(() => {
    if (!ref.current || !settled) return;
    const { width, height } = measureElement(ref.current);
    onMeasure(turn.id, width, height + INTER_TURN_GAP);
  }, [turn, settled, onMeasure]);

  return (
    <Box ref={ref} flexDirection="column" flexShrink={0}>
      <TurnView turn={turn} />
    </Box>
  );
});
