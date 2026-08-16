import { Box, Text } from "ink";
import React, { useEffect, useRef, useState } from "react";

interface GenerationTimerProps {
  /** Whether generation is currently active. */
  active: boolean;
  /** Temporary status message rendered inline after the stopwatch. */
  message?: string | null;
}

function format(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * A stopwatch that starts the moment generation becomes active and freezes
 * (showing the final elapsed time) once it completes. Resets to 0:00 on the
 * next generation.
 */
export function GenerationTimer({ active, message }: GenerationTimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (active && startRef.current === null) {
      startRef.current = Date.now();
      setElapsed(0);
    } else if (!active && startRef.current !== null) {
      // Freeze at the final elapsed value; clear the start ref so the next
      // activation resets from zero.
      setElapsed((Date.now() - startRef.current) / 1000);
      startRef.current = null;
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (startRef.current !== null) {
        setElapsed((Date.now() - startRef.current) / 1000);
      }
    }, 100);
    return () => clearInterval(id);
  }, [active]);

  // marginLeft lines the row up with the prompt's text, which starts after "❯ ".
  return (
    <Box flexWrap="wrap" marginTop={1} marginLeft={2}>
      <Text color={active ? "cyan" : undefined} dimColor={!active}>
        {format(elapsed)}
      </Text>
      {message ? (
        <Text color="yellow">
          {"   "}
          {message}
        </Text>
      ) : null}
    </Box>
  );
}
