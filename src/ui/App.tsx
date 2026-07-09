import { Box, Static, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import React, { useEffect, useMemo, useState } from "react";
import type { Agent, ContextUsage } from "@fifthrevision/axle";
import { writeConfig } from "../config.js";
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

const COMMANDS: { name: string; desc: string }[] = [
  { name: "/model", desc: "switch model (picker, or /model <substr>)" },
  { name: "/compact", desc: "summarize + shrink the conversation" },
  { name: "/save", desc: "save the session [name]" },
  { name: "/load", desc: "restore a saved session [name]" },
  { name: "/sessions", desc: "list saved sessions" },
  { name: "/index", desc: "demo a host annotation lifecycle" },
  { name: "/exit", desc: "quit" },
  { name: "/quit", desc: "quit" },
];

function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) return "";
  let prefix = values[0];
  for (const value of values.slice(1)) {
    while (!value.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
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
    () =>
      catalog.map((e) => ({
        label: e.available ? e.label : `${e.label}  (unavailable — set ${e.keyEnv})`,
        value: e.id,
        key: e.id,
      })),
    [catalog],
  );

  const availableByLabel = useMemo(
    () => new Map(catalog.map((e) => [e.id, e.available])),
    [catalog],
  );

  // Custom picker row: unavailable models render gray and dim. Stable across
  // renders (catalog never changes) so the SelectInput selection isn't reset.
  const ModelItem = useMemo(() => {
    function Item({ isSelected, label, value }: { isSelected?: boolean; label: string; value?: string }) {
      if (value && availableByLabel.get(value) === false) {
        return (
          <Text color="gray" dimColor>
            {label}
          </Text>
        );
      }
      return <Text color={isSelected ? "cyan" : undefined}>{label}</Text>;
    }
    return Item;
  }, [availableByLabel]);

  // Slash-command autocomplete: only while typing the command word itself
  // (a leading "/", no space yet).
  const suggestions = useMemo(() => {
    if (!input.startsWith("/") || input.includes(" ")) return [];
    const q = input.toLowerCase();
    const matches = COMMANDS.filter((c) => c.name.startsWith(q));
    return matches.length === 1 && matches[0].name === input ? [] : matches;
  }, [input]);

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
      return;
    }
    // Tab completes the slash command: to the single match (+ space for args),
    // else to the longest shared prefix.
    if (key.tab && mode === "input" && suggestions.length > 0) {
      if (suggestions.length === 1) {
        setInput(suggestions[0].name + " ");
      } else {
        const prefix = longestCommonPrefix(suggestions.map((s) => s.name));
        if (prefix.length > input.length) setInput(prefix);
      }
    }
  });

  // The cancel indicator is transient — clear it once the turn actually settles.
  useEffect(() => {
    if (status === "idle" && cancelling) setCancelling(false);
  }, [status, cancelling]);

  async function switchModel(next: ModelEntry) {
    if (!next.available || !next.provider) {
      setNotice(`${next.label} needs credentials — set ${next.keyEnv} and relaunch.`);
      return;
    }
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
      // Remember the choice so the next launch starts here.
      void writeConfig({ defaultModel: next.id });
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
      const query = trimmed.slice("/model ".length).trim();
      const match = findEntry(catalog, query);
      if (!match) setNotice(`No model matches "${query}".`);
      else void switchModel(match);
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
            itemComponent={ModelItem}
            limit={12}
            initialIndex={Math.max(
              0,
              items.findIndex((i) => i.value === entry.id),
            )}
            onSelect={(item) => {
              const next = catalog.find((e) => e.id === item.value);
              if (!next) return;
              if (!next.available) {
                // Not selectable — keep the picker open and say why.
                setNotice(`${next.label} needs credentials — set ${next.keyEnv} and relaunch.`);
                return;
              }
              setMode("input");
              void switchModel(next);
            }}
          />
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
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
            <>
              <Box>
                <Text color="blue">❯ </Text>
                <TextInput
                  value={input}
                  onChange={setInput}
                  onSubmit={onSubmit}
                  placeholder="Ask me… (/model to switch, /exit to quit)"
                />
              </Box>
              {suggestions.length > 0 ? (
                <Box flexDirection="column" marginLeft={2}>
                  {suggestions.map((s) => (
                    <Box key={s.name}>
                      <Box width={12}>
                        <Text color="cyan">{s.name}</Text>
                      </Box>
                      <Text color="gray">{s.desc}</Text>
                    </Box>
                  ))}
                  <Text color="gray" dimColor>
                    Tab to complete
                  </Text>
                </Box>
              ) : null}
            </>
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
