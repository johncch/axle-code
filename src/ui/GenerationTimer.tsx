import { Box } from "ink";
import React, { useEffect, useRef, useState } from "react";
import { Shimmer } from "./Shimmer.js";
import { ThemeText } from "./ThemeText.js";
import { theme } from "./theme.js";
import { DOT } from "./render.js";

// cli-spinners' "dots2": the dense 8-dot braille set, stepped at 80ms —
// fills the whole cell evenly so it reads centred next to the ▪ idle marker
// (the classic homebrew "dots" set floats high in the cell by comparison).
const SPINNER_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
const SPINNER_MS = 80;

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

/** Idle label for the last generation's elapsed time: `Idle (32s)`, rolling
 * over to minutes only once the seconds would grow past two digits. */
function formatIdle(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) return `Idle (${s}s)`;
  return `Idle (${Math.floor(s / 60)}m${s % 60}s)`;
}

/**
 * While generation is active: Homebrew's braille spinner + a stopwatch that
 * starts the moment generation begins. When it completes, the row reverts to
 * a quiet `▪ Idle (Ns)` marker showing the final elapsed time — the last
 * generation's duration stays readable until the next one resets it. A 0s
 * value (fresh start, resumed session, instant cancel) earns no marker.
 */
export function GenerationTimer({ active, message }: GenerationTimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const [frame, setFrame] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (active && startRef.current === null) {
      startRef.current = Date.now();
      setElapsed(0);
      setFrame(0);
    } else if (!active && startRef.current !== null) {
      // Freeze at the final elapsed value; clear the start ref so the next
      // activation resets from zero.
      setElapsed((Date.now() - startRef.current) / 1000);
      startRef.current = null;
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => {
      if (startRef.current !== null) {
        setElapsed((Date.now() - startRef.current) / 1000);
      }
    }, 100);
    const spin = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), SPINNER_MS);
    return () => {
      clearInterval(tick);
      clearInterval(spin);
    };
  }, [active]);

  // Fresh session (or resumed with no generation yet): nothing to time and
  // nothing to say — no row at all, so no stray gap above the prompt.
  if (!active && Math.floor(elapsed) < 1 && !message) return null;

  // No indent: the spinner/square sits at column 0, aligned with the ❯
  // prompt and the transcript's markers.
  return (
    <Box flexWrap="wrap" marginTop={1}>
      {active ? (
        <ThemeText token={theme.accent}>
          {SPINNER_FRAMES[frame]} {format(elapsed)}
        </ThemeText>
      ) : Math.floor(elapsed) >= 1 ? (
        <ThemeText token={theme.faint}>
          {DOT} {formatIdle(elapsed)}
        </ThemeText>
      ) : null}
      {message ? (
        active ? (
          <Shimmer text={`   ${message}`} active />
        ) : (
          <ThemeText token={theme.warning}>{"   "}{message}</ThemeText>
        )
      ) : null}
    </Box>
  );
}