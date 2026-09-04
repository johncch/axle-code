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

/** Text shown in the message slot while generation runs and no status
 * message has claimed the space. */
const STEER_TEXT = "Type below to pause and steer, Esc to cancel";

function format(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Idle label for the last generation's elapsed time: `Idle (32s)`, rolling
 * over to minutes past a minute. A 0s value (fresh start, resumed session,
 * instant cancel) omits the parenthetical — there's no duration to show. */
function formatIdle(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 1) return "Idle";
  if (s < 60) return `Idle (${s}s)`;
  return `Idle (${Math.floor(s / 60)}m${s % 60}s)`;
}

/**
 * The always-present activity row, in two segments:
 *
 *   ⣾ 0:32   Type text below to steer…   ← activity, shimmering slot
 *   ⣾ 0:32   Display: succinct.          ← status message claims the slot
 *   ▪ Idle (32s)                         ← quiet when nothing is running
 *   ▪ Idle   Saved session to foo.       ← idle, message borrows the space
 *
 * The message slot sits to the right of the timer: while active it normally
 * renders the shimmering steer hint, and a transient status message replaces
 * that text for its lifetime (the App side times it out); when idle the slot
 * is empty until a status message borrows it. Rendering the row
 * unconditionally keeps the chrome's height stable.
 */
export function GenerationTimer({
  active,
  message,
}: {
  active: boolean;
  /** Transient status text occupying the message slot, if any. */
  message?: string | null;
}) {
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

  // Column 0: aligned with the ❯ prompt and the transcript's markers.
  return (
    <Box flexWrap="wrap" marginTop={1}>
      {active ? (
        <ThemeText token={theme.accent}>
          {SPINNER_FRAMES[frame]} {format(elapsed)}
        </ThemeText>
      ) : (
        <ThemeText token={theme.faint}>
          {DOT} {formatIdle(elapsed)}
        </ThemeText>
      )}
      {message ? (
        <ThemeText token={theme.warning}>{"   "}{message}</ThemeText>
      ) : active ? (
        <Shimmer text={`   ${STEER_TEXT}`} active />
      ) : null}
    </Box>
  );
}