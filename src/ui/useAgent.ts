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
 * Bridges Axle's public event stream into React state. We fold every TurnEvent
 * through our own TurnAccumulator (the pattern a remote/wire UI would use) and
 * mirror the resulting Turn[] into component state.
 */
export function useAgent(agent: Agent): UseAgentResult {
  const accumulatorRef = useRef<TurnAccumulator>(new TurnAccumulator());
  const handleRef = useRef<AgentHandle | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sessionAnnotations, setSessionAnnotations] = useState<Annotation[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);

  const sync = useCallback(() => {
    setTurns(accumulatorRef.current.state.turns);
    setSessionAnnotations(accumulatorRef.current.state.sessionAnnotations ?? []);
  }, []);

  useEffect(() => {
    const off = agent.on((event) => {
      accumulatorRef.current.apply(event);
      sync();
    });
    return off;
  }, [agent, sync]);

  const reset = useCallback(
    (init?: { turns?: Turn[]; sessionAnnotations?: Annotation[] }) => {
      accumulatorRef.current = new TurnAccumulator(
        init ? { turns: init.turns ?? [], sessionAnnotations: init.sessionAnnotations ?? [] } : undefined,
      );
      sync();
    },
    [sync],
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
        });
    },
    [agent],
  );

  const cancel = useCallback(() => {
    handleRef.current?.cancel("user cancelled");
  }, []);

  const clearError = useCallback(() => setLastError(null), []);

  const applyEvent = useCallback(
    (event: TurnEvent) => {
      accumulatorRef.current.apply(event);
      sync();
    },
    [sync],
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
