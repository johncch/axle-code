import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent, AgentHandle } from "@fifthrevision/axle";
import { AxleAgentAbortError } from "@fifthrevision/axle";
import { TurnAccumulator } from "@fifthrevision/axle/ui";
import type { Annotation, Turn, TurnEvent } from "@fifthrevision/axle/ui";
import { formatGenerateError } from "../format.js";

export type AgentStatus = "idle" | "streaming";

export interface UseAgentResult {
  turns: Turn[];
  sessionAnnotations: Annotation[];
  status: AgentStatus;
  lastError: string | null;
  send: (message: string) => void;
  cancel: () => void;
  clearError: () => void;
  /** Replace the accumulator's state, e.g. after loading a saved session. */
  reset: (init?: { turns?: Turn[]; sessionAnnotations?: Annotation[] }) => void;
  /** Fold a host-originated event (e.g. an annotation) into the UI state. */
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
 * through our own TurnAccumulator (the pattern a remote/wire UI would use) and
 * mirror the resulting Turn[] into component state.
 *
 * Events are applied to the accumulator synchronously (so its state is always
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
  initial?: { turns?: Turn[]; sessionAnnotations?: Annotation[] },
): UseAgentResult {
  const accumulatorRef = useRef<TurnAccumulator>(null as unknown as TurnAccumulator);
  if (!accumulatorRef.current) {
    accumulatorRef.current = new TurnAccumulator(
      initial
        ? { turns: initial.turns ?? [], sessionAnnotations: initial.sessionAnnotations ?? [] }
        : undefined,
    );
  }
  const handleRef = useRef<AgentHandle | null>(null);
  const [turns, setTurns] = useState<Turn[]>(initial?.turns ?? []);
  const [sessionAnnotations, setSessionAnnotations] = useState<Annotation[]>(
    initial?.sessionAnnotations ?? [],
  );
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);

  // Coalesced-flush bookkeeping. `dirtyRef` records that the accumulator has
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
    const state = accumulatorRef.current.state;
    setTurns(state.turns);
    setSessionAnnotations(state.sessionAnnotations ?? []);
  }, []);

  const scheduleFlush = useCallback(() => {
    dirtyRef.current = true;
    if (timerRef.current !== null) return; // already scheduled
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        const state = accumulatorRef.current.state;
        setTurns(state.turns);
        setSessionAnnotations(state.sessionAnnotations ?? []);
      }
    }, FLUSH_MS);
  }, []);

  useEffect(() => {
    const off = agent.on((event) => {
      accumulatorRef.current.apply(event);
      // Terminal events settle the turn — flush immediately so the final frame
      // (and the idle transition) lands without waiting out the throttle.
      const terminal =
        event.type === "turn:end" || event.type === "error" || event.type === "compaction:end";
      if (terminal) flushSync();
      else scheduleFlush();
    });
    return off;
  }, [agent, scheduleFlush, flushSync]);

  // Always clear any pending flush on unmount.
  useEffect(() => () => void flushSync(), [flushSync]);

  const reset = useCallback(
    (init?: { turns?: Turn[]; sessionAnnotations?: Annotation[] }) => {
      accumulatorRef.current = new TurnAccumulator(
        init ? { turns: init.turns ?? [], sessionAnnotations: init.sessionAnnotations ?? [] } : undefined,
      );
      // Force flushSync to actually emit the new accumulator's state — without
      // this, dirtyRef is false and flushSync bails early, so loaded/cleared
      // turns never reach React state. (On initial mount this is masked by the
      // workspace annotation effect happening to schedule a flush afterward,
      // but that effect doesn't re-run on agent swaps like /load and /clear.)
      dirtyRef.current = true;
      flushSync();
    },
    [flushSync],
  );

  const send = useCallback(
    (message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      setLastError(null);
      setStatus("streaming");
      const handle = agent.send(trimmed);
      handleRef.current = handle;
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
        .finally(() => {
          handleRef.current = null;
          setStatus("idle");
          // The turn:end event flushes the final turn state, but make sure no
          // throttled delta is left pending when we go idle.
          flushSync();
        });
    },
    [agent, flushSync],
  );

  const cancel = useCallback(() => {
    handleRef.current?.cancel("user cancelled");
  }, []);

  const clearError = useCallback(() => setLastError(null), []);

  const applyEvent = useCallback(
    (event: TurnEvent) => {
      accumulatorRef.current.apply(event);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  return {
    turns,
    sessionAnnotations,
    status,
    lastError,
    send,
    cancel,
    clearError,
    reset,
    applyEvent,
  };
}
