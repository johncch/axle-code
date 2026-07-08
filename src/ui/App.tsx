import { Box, Static, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import React, { useEffect, useMemo, useState } from "react";
import type { Agent, ContextUsage } from "@fifthrevision/axle";
import { findEntry, type ModelEntry } from "../models.js";
import { listSessions, loadSession, saveSession } from "../session.js";
import { AnnotationBar } from "./AnnotationBar.js";
import { StatusBar } from "./StatusBar.js";
import { TurnView } from "./TurnView.js";
import { useAgent } from "./useAgent.js";

export interface AppProps {
  catalog: ModelEntry[];
  initialEntry: ModelEntry;
  createAgent: (entry: ModelEntry, session?: Awaited<ReturnType<Agent["snapshot"]>>) => Agent;
}

export function App({ catalog, initialEntry, createAgent }: AppProps) {
  const [agent, setAgent] = useState<Agent>(() => createAgent(initialEntry));
  const [entry, setEntry] = useState<ModelEntry>(initialEntry);
  const { turns, sessionAnnotations, status, lastError, send, cancel, reset, applyEvent } =
    useAgent(agent);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"input" | "picker">("input");
  const [notice, setNotice] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const { exit } = useApp();

  const items = useMemo(
    () => catalog.map((e) => ({ label: e.label, value: e.id, key: e.id })),
    [catalog],
  );

  const context = useMemo<ContextUsage | null>(() => {
    try {
      return agent.context();
    } catch {
      return null;
    }
    // Recompute as turns land (history grows) or the model changes.
  }, [agent, turns]);

  const sessionUsage = useMemo(
    () =>
      turns.reduce(
        (acc, t) => (t.usage ? { in: acc.in + t.usage.in, out: acc.out + t.usage.out } : acc),
        { in: 0, out: 0 },
      ),
    [turns],
  );

  // Demo a persistent, host-owned session annotation (out-of-band UI state that
  // is not part of the model conversation).
  useEffect(() => {
    applyEvent({
      type: "annotation:start",
      target: { type: "session" },
      annotation: { id: "workspace", kind: "workspace", label: `workspace: ${process.cwd()}` },
    });
  }, [applyEvent]);

  useInput((_input, key) => {
    if (key.escape) {
      if (mode === "picker") {
        setMode("input");
        setNotice(null);
      } else if (status === "streaming") {
        cancel();
        setCancelling(true);
      }
    }
  });

  // The cancel indicator is transient — clear it once the turn actually settles.
  useEffect(() => {
    if (status === "idle" && cancelling) setCancelling(false);
  }, [status, cancelling]);

  async function switchModel(next: ModelEntry) {
    if (next.id === entry.id) {
      setNotice(`Already on ${next.label}.`);
      return;
    }
    setSwitching(true);
    setNotice(`Switching to ${next.label}…`);
    try {
      // Carry the conversation across: snapshot current session, rebuild the
      // agent on the new provider/model with that session restored. The UI's
      // own accumulator keeps its turns, so scrollback is uninterrupted.
      const session = await agent.snapshot();
      const nextAgent = createAgent(next, session);
      setAgent(nextAgent);
      setEntry(next);
      setNotice(`Switched to ${next.label}.`);
    } catch (error) {
      setNotice(`Switch failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSwitching(false);
    }
  }

  async function doSave(name: string) {
    try {
      const session = await agent.snapshot();
      const path = await saveSession(name, entry.id, session);
      setNotice(`Saved session to ${path}`);
    } catch (error) {
      setNotice(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function doLoad(name: string) {
    try {
      const { modelId, session } = await loadSession(name);
      const loadedEntry = findEntry(catalog, modelId) ?? entry;
      const nextAgent = createAgent(loadedEntry, session);
      setAgent(nextAgent);
      setEntry(loadedEntry);
      // The restored agent seeds its turns internally but does not re-emit them,
      // so point the UI accumulator at the loaded turn state directly.
      reset({ turns: session.turns, sessionAnnotations: session.sessionAnnotations });
      setNotice(`Loaded "${name}" (${loadedEntry.label}).`);
    } catch (error) {
      setNotice(`Load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function doListSessions() {
    const names = await listSessions();
    setNotice(names.length ? `Saved sessions: ${names.join(", ")}` : "No saved sessions.");
  }

  const onSubmit = (value: string) => {
    if (status === "streaming" || switching || compacting) return;
    const trimmed = value.trim();
    setInput("");

    if (trimmed === "/exit" || trimmed === "/quit") {
      exit();
      return;
    }
    if (trimmed === "/model") {
      setNotice(null);
      setMode("picker");
      return;
    }
    if (trimmed === "/compact") {
      setNotice(null);
      setCompacting(true);
      agent
        .compact()
        .then((record) => setNotice(record ? "Context compacted." : "Nothing to compact yet."))
        .catch((error) =>
          setNotice(`Compact failed: ${error instanceof Error ? error.message : String(error)}`),
        )
        .finally(() => setCompacting(false));
      return;
    }
    if (trimmed.startsWith("/model ")) {
      const match = findEntry(catalog, trimmed.slice("/model ".length));
      if (match) void switchModel(match);
      else setNotice(`No model matches "${trimmed.slice("/model ".length).trim()}".`);
      return;
    }
    if (trimmed === "/save" || trimmed.startsWith("/save ")) {
      void doSave(trimmed.slice("/save".length).trim() || "session");
      return;
    }
    if (trimmed === "/load" || trimmed.startsWith("/load ")) {
      void doLoad(trimmed.slice("/load".length).trim() || "session");
      return;
    }
    if (trimmed === "/sessions") {
      void doListSessions();
      return;
    }
    if (trimmed === "/index") {
      // Demonstrate an annotation lifecycle: running → complete.
      const id = `index-${Date.now()}`;
      applyEvent({
        type: "annotation:start",
        target: { type: "session" },
        annotation: { id, kind: "index", label: "Indexing workspace…", status: "running" },
      });
      setTimeout(() => {
        applyEvent({
          type: "annotation:end",
          target: { type: "session" },
          annotation: { id, kind: "index", label: "Workspace indexed ✓", status: "complete" },
        });
      }, 1500);
      return;
    }
    if (trimmed.startsWith("/")) {
      setNotice(`Unknown command: ${trimmed.split(/\s/)[0]} · try /model /compact /save /load /index /exit`);
      return;
    }
    setNotice(null);
    send(trimmed);
  };

  const busy = status === "streaming" || switching || compacting;

  // Completed turns never change again → render once via <Static>; the in-flight
  // turn changes on every delta, so it renders live below.
  const settled = turns.filter((turn) => turn.status !== "streaming");
  const active = turns.filter((turn) => turn.status === "streaming");

  return (
    <Box flexDirection="column">
      <Static items={settled}>{(turn) => <TurnView key={turn.id} turn={turn} />}</Static>
      {active.map((turn) => (
        <TurnView key={turn.id} turn={turn} />
      ))}

      {mode === "picker" ? (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text color="cyan">Select a model (↑/↓, Enter to choose, Esc to cancel):</Text>
          <SelectInput
            items={items}
            limit={8}
            initialIndex={Math.max(
              0,
              items.findIndex((i) => i.value === entry.id),
            )}
            onSelect={(item) => {
              const next = catalog.find((e) => e.id === item.value);
              setMode("input");
              if (next) void switchModel(next);
            }}
          />
        </Box>
      ) : (
        <Box marginTop={1}>
          {busy ? (
            <Text color="cyan">
              {switching
                ? "…switching model"
                : compacting
                  ? "…compacting context"
                  : cancelling
                    ? "…cancelling"
                    : "…working (Esc to cancel)"}
            </Text>
          ) : (
            <Box>
              <Text color="blue">❯ </Text>
              <TextInput
                value={input}
                onChange={setInput}
                onSubmit={onSubmit}
                placeholder="Ask me… (/model to switch, /exit to quit)"
              />
            </Box>
          )}
        </Box>
      )}

      {lastError ? (
        <Box marginTop={1}>
          <Text color="red">✖ {lastError}</Text>
        </Box>
      ) : null}

      {notice ? (
        <Box marginTop={1}>
          <Text color="yellow">{notice}</Text>
        </Box>
      ) : null}

      <AnnotationBar annotations={sessionAnnotations} />

      <StatusBar
        entry={entry}
        context={context}
        sessionUsage={sessionUsage}
        hint="/model · /compact · /save · /load · /index · /exit"
      />
    </Box>
  );
}
