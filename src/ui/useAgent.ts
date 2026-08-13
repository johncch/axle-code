import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent, AgentHandle } from "@fifthrevision/axle";
import { AxleAgentAbortError } from "@fifthrevision/axle";
import { Transcript } from "@fifthrevision/axle/ui";
import type { Turn, TurnEvent } from "@fifthrevision/axle/ui";
import { formatGenerateError } from "../format.js";

export type AgentStatus = "idle" | "streaming";

export interface UseAgentResult {
  turns: Turn[];
  status: AgentStatus;
  lastError: string | null;
  send: (message: string) => void;
  /** Ask the active turn to finish at its next tool-call boundary. */
  stop: () => void;
  cancel: () => void;
  clearError: () => void;
  /** Replace the transcript's state, e.g. after loading a saved session. */
  reset: (init?: { turns?: Turn[] }) => void;
  /** Fold a host-originated event into the UI state. */
  applyEvent: (event: TurnEvent) => void;
}

/**
 * Minimum gap between React state flushes, in ms. During streaming the model
 * emits `text:delta` (and other) events far faster than a terminal can repaint
 * usefully — a token at a time, often 30+/sec. Coalescing into ~16fps renders
 * keeps the UI responsive without per-token full-tree reflows, which were the
 * source of the flashing/layout jitter (especially with a long live turn).
 */
const FLUSH_MS = 16;

/**
 * Bridges Axle's public event stream into React state. We fold every TurnEvent
 * through our own Transcript (the pattern a remote/wire UI would use) and
 * mirror the resulting Turn[] into component state.
 *
 * Events are applied to the transcript synchronously (so its state is always
 * current for a caller using `applyEvent`), but the mirror into React state is
 * throttled: rapid deltas are coalesced into a single render per frame. A
 * flush is forced immediately on terminal transitions (idle/error) so the final
 * state of a turn is never left stale.
 */
export function useAgent(
  agent: Agent,
  /** Seed state (e.g. a restored session) applied synchronously on first
   * render, so the initial frame already shows the transcript — no
   * seed-in-an-effect flash. */
  initial?: { turns?: Turn[] },
): UseAgentResult {
  const transcriptRef = useRef<Transcript>(null as unknown as Transcript);
  if (!transcriptRef.current) {
    transcriptRef.current = new Transcript(initial?.turns);
  }
  const handleRef = useRef<AgentHandle | null>(null);
  const [turns, setTurns] = useState<Turn[]>(initial?.turns ?? []);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);

  // Coalesced-flush bookkeeping. `dirtyRef` records that the transcript has
  // changed since the last React commit; `timerRef` holds the scheduled flush.
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushSync = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    setTurns([...transcriptRef.current.turns]);
  }, []);

  const scheduleFlush = useCallback(() => {
    dirtyRef.current = true;
    if (timerRef.current !== null) return; // already scheduled
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        setTurns([...transcriptRef.current.turns]);
      }
    }, FLUSH_MS);
  }, []);

  useEffect(() => {
    const off = agent.on((event) => {
      transcriptRef.current.apply(event);
      // Terminal events settle the turn — flush immediately so the final frame
      // (and the idle transition) lands without waiting out the throttle.
      const terminal =
        event.type === "turn:end" ||
        event.type === "error" ||
        event.type === "compaction:complete" ||
        event.type === "compaction:error";
      if (terminal) flushSync();
      else scheduleFlush();
    });
    return off;
  }, [agent, scheduleFlush, flushSync]);

  // Always clear any pending flush on unmount.
  useEffect(() => () => void flushSync(), [flushSync]);

  const reset = useCallback(
    (init?: { turns?: Turn[] }) => {
      transcriptRef.current = new Transcript(init?.turns);
      // Force flushSync to actually emit the new transcript's state — without
      // this, dirtyRef is false and flushSync bails early, so loaded/cleared
      // turns never reach React state.
      dirtyRef.current = true;
      flushSync();
    },
    [flushSync],
  );

  // Sends are queued FIFO by the agent's scheduler, so a user can interject a
  // steering message while a turn is running. We therefore track every
  // in-flight handle in a queue: the front is the one currently executing (and
  // the one `cancel` acts on), and status stays "streaming" until the last
  // queued turn settles.
  const handlesRef = useRef<AgentHandle[]>([]);

  const popSettled = useCallback(() => {
    const handles = handlesRef.current;
    if (handles.length === 0) return;
    // The settled handle is always the front of the FIFO queue.
    handles.shift();
    if (handles.length === 0) {
      handleRef.current = null;
      setStatus("idle");
      // The turn:end event flushes the final turn state, but make sure no
      // throttled delta is left pending when we go idle.
      flushSync();
    } else {
      handleRef.current = handles[0] ?? null;
    }
  }, [flushSync]);

  const settle = useCallback(
    (handle: AgentHandle) => {
      handle.final
        .then((result) => {
          // Non-fatal failures (model/tool/parse) resolve with ok:false; the
          // turn already renders an error marker, this surfaces the detail.
          if (result && !result.ok) setLastError(formatGenerateError(result.error));
        })
        .catch((error) => {
          // A user-initiated cancel is expected, not an error to display.
          if (error instanceof AxleAgentAbortError) return;
          setLastError(error instanceof Error ? error.message : String(error));
        })
        .finally(popSettled);
    },
    [popSettled],
  );

  const send = useCallback(
    (message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      setLastError(null);
      setStatus("streaming");
      const handle = agent.send(trimmed);
      handlesRef.current.push(handle);
      if (!handleRef.current) handleRef.current = handle;
      settle(handle);
    },
    [agent, settle],
  );

  // Ask the active turn to finish at its next tool-batch boundary. Queued
  // sends (e.g. an earlier steering message) are unaffected — they run against
  // the committed history once the active turn settles.
  const stop = useCallback(() => {
    agent.stop();
  }, [agent]);

  // Cancel the currently active turn (the front of the queue). Queued steering
  // messages are left to run once it settles.
  const cancel = useCallback(() => {
    handleRef.current?.cancel("user cancelled");
  }, []);

  const clearError = useCallback(() => setLastError(null), []);

  const applyEvent = useCallback(
    (event: TurnEvent) => {
      transcriptRef.current.apply(event);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  return {
    turns,
    status,
    lastError,
    send,
    stop,
    cancel,
    clearError,
    reset,
    applyEvent,
  };
}
