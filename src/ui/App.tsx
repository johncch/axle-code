import { Box, Text, measureElement, useApp, useInput, useWindowSize, type DOMElement } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Agent, ContextUsage } from "@fifthrevision/axle";
import type { Turn } from "@fifthrevision/axle/ui";
import { writeConfig } from "../config.js";
import { findEntry, type ModelEntry } from "../models.js";
import { getCompactionFocus } from "../agent.js";
import { AUTOSAVE_NAME, listSessions, loadSession, rotateCurrentSession, saveSession } from "../session.js";
import { formatVersion } from "../version.js";
import { AnnotationBar } from "./AnnotationBar.js";
import { GenerationTimer } from "./GenerationTimer.js";
import { StatusBar } from "./StatusBar.js";
import { TurnView } from "./TurnView.js";
import { useAgent } from "./useAgent.js";

export interface AppProps {
  catalog: ModelEntry[];
  initialEntry: ModelEntry;
  createAgent: (entry: ModelEntry, session?: Awaited<ReturnType<Agent["snapshot"]>>) => Agent;
  /** Restored autosave session, if any. Seeds the UI on mount. */
  initialSession?: Awaited<ReturnType<Agent["snapshot"]>>;
}

const COMMANDS: { name: string; desc: string }[] = [
  { name: "/model", desc: "switch model (picker, or /model <substr>)" },
  { name: "/compact", desc: "summarize + shrink [optional focus prompt]" },
  { name: "/save", desc: "save the session [name]" },
  { name: "/load", desc: "restore a saved session [name]" },
  { name: "/sessions", desc: "list saved sessions" },
  { name: "/clear", desc: "archive current session and start fresh" },
  { name: "/index", desc: "demo a host annotation lifecycle" },
  { name: "/version", desc: "show build sha + date" },
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

// Rough transcript height in lines (ignores wrapping) — only used to pick the
// right anchoring for the very first frame of a restored session, before the
// real measurement lands. Underestimating just means one top-anchored frame.
function roughLines(turns: Turn[] | undefined): number {
  let n = 0;
  for (const turn of turns ?? []) {
    n += 2;
    for (const part of turn.parts) {
      n += part.type === "text" || part.type === "thinking" ? (part.text?.split("\n").length ?? 1) : 3;
    }
  }
  return n;
}

export function App({ catalog, initialEntry, createAgent, initialSession }: AppProps) {
  const [agent, setAgent] = useState<Agent>(() => createAgent(initialEntry, initialSession));
  const [entry, setEntry] = useState<ModelEntry>(initialEntry);
  const { turns, sessionAnnotations, status, lastError, send, cancel, reset, applyEvent } =
    useAgent(agent, initialSession);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"input" | "picker" | "sessions">("input");
  const [sessionNames, setSessionNames] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const quittingRef = useRef(false);
  const { exit } = useApp();
  const { rows } = useWindowSize();

  // The transcript is a viewport over in-memory history (the tmux model: the
  // alternate screen has no scrollback, so we own scrolling ourselves).
  //
  // `filled`: sticky flag — false while the conversation is shorter than the
  // viewport (content top-flows, chrome docked via the viewport's leftover
  // space); true once it has filled the screen (content bottom-anchors via
  // justifyContent="flex-end" and older lines clip off the top). Seeded from
  // a rough estimate for restored sessions so the first frame is already
  // anchored correctly.
  //
  // `scrollTop`: null = follow the bottom (normal chat mode); a number =
  // pinned, counting the content lines hidden above the viewport
  // (rendered as a negative top margin inside the clipping box).
  const [filled, setFilled] = useState(() => roughLines(initialSession?.turns) >= rows);
  const [scrollTop, setScrollTop] = useState<number | null>(null);
  const viewportRef = useRef<DOMElement>(null);
  const contentRef = useRef<DOMElement>(null);
  // Latest measured heights (content = full transcript, viewport = its
  // clipping window). Read by the scroll-key handlers; refreshed after every
  // commit, so it's current whenever a key can arrive.
  const sizeRef = useRef({ content: 0, viewport: 0 });

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
          <Text color={isSelected ? "cyan" : undefined}>{label}</Text>
        );
      }
      return <Text color={isSelected ? "cyan" : undefined}>{label}</Text>;
    }
    return Item;
  }, [availableByLabel]);

  // Slash-command + argument autocomplete.
  const suggestions = useMemo(() => {
    if (!input.startsWith("/")) return [];

    const spaceIdx = input.indexOf(" ");

    // Command-word completion (no space yet): match command names.
    if (spaceIdx === -1) {
      const q = input.toLowerCase();
      const matches = COMMANDS.filter((c) => c.name.startsWith(q));
      return matches.length === 1 && matches[0].name === input ? [] : matches;
    }

    // Argument completion (after space): match against the command's domain.
    const cmd = input.slice(0, spaceIdx).toLowerCase();
    const arg = input.slice(spaceIdx + 1).toLowerCase();

    if (cmd === "/model") {
      return catalog
        .filter(
          (e) =>
            e.id.toLowerCase().includes(arg) ||
            e.label.toLowerCase().includes(arg) ||
            e.model.toLowerCase().includes(arg),
        )
        .map((e) => ({ name: e.id, desc: e.label }));
    }

    if (cmd === "/load" || cmd === "/save") {
      return sessionNames
        .filter((n) => n.toLowerCase().includes(arg))
        .map((n) => ({ name: n, desc: "" }));
    }

    return [];
  }, [input, catalog, sessionNames]);

  // Lazily load saved session names when the user types /load or /save with an
  // argument, so the argument autocomplete has data to match against.
  useEffect(() => {
    if (/^\/(load|save)\s/.test(input)) {
      listSessions().then(setSessionNames).catch(() => {});
    }
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
    // Ctrl-C: clear input first; if already empty, quit. In raw mode (which
    // Ink uses with exitOnCtrlC:false) this arrives as a key event, not SIGINT,
    // so it doesn't conflict with the process signal handler.
    if (key.ctrl && _input === "c") {
      if (mode === "picker" || mode === "sessions") {
        setMode("input");
        setNotice(null);
      } else if (status === "streaming") {
        cancel();
        setCancelling(true);
      } else if (input.length > 0) {
        setInput("");
      } else {
        void quit();
      }
      return;
    }
    // Viewport scrolling (tmux copy-mode-lite): PgUp/PgDn page, ↑/↓ step —
    // most terminals translate the mouse wheel into arrow keys on the
    // alternate screen. Only in input mode: the pickers own ↑/↓ themselves.
    if (mode === "input") {
      const page = Math.max(1, sizeRef.current.viewport - 1);
      if (key.pageUp) {
        scrollBy(-page);
        return;
      }
      if (key.pageDown) {
        scrollBy(page);
        return;
      }
      if (key.upArrow) {
        scrollBy(-2);
        return;
      }
      if (key.downArrow) {
        scrollBy(2);
        return;
      }
    }
    if (key.escape) {
      if (mode === "picker" || mode === "sessions") {
        setMode("input");
        setNotice(null);
      } else if (status === "streaming") {
        cancel();
        setCancelling(true);
      } else if (scrollTop !== null) {
        setScrollTop(null);
      }
      return;
    }
    // Tab completes: command word → single match (+ space for args), else
    // longest shared prefix. After a space, completes the argument value.
    if (key.tab && mode === "input" && suggestions.length > 0) {
      const hasSpace = input.includes(" ");
      if (suggestions.length === 1) {
        if (hasSpace) {
          // Replace the argument with the completed value.
          const cmd = input.slice(0, input.indexOf(" ") + 1);
          setInput(cmd + suggestions[0].name);
        } else {
          setInput(suggestions[0].name + " ");
        }
      } else {
        const prefix = longestCommonPrefix(suggestions.map((s) => s.name));
        if (hasSpace) {
          const cmd = input.slice(0, input.indexOf(" ") + 1);
          if (prefix.length > input.slice(input.indexOf(" ") + 1).length) {
            setInput(cmd + prefix);
          }
        } else {
          if (prefix.length > input.length) setInput(prefix);
        }
      }
    }
  });

  // The cancel indicator is transient — clear it once the turn actually settles.
  useEffect(() => {
    if (status === "idle" && cancelling) setCancelling(false);
  }, [status, cancelling]);

  // Measure the transcript and its clipping window after every commit. This
  // feeds the scroll-key handlers (sizeRef), flips `filled` the moment the
  // conversation outgrows the viewport, and clamps a pinned scroll back to
  // follow mode when it reaches the bottom (e.g. after a resize).
  useEffect(() => {
    if (!viewportRef.current || !contentRef.current) return;
    const viewport = measureElement(viewportRef.current).height;
    const content = measureElement(contentRef.current).height;
    sizeRef.current = { content, viewport };
    if (viewport <= 0) return;
    if (!filled && content >= viewport) setFilled(true);
    if (scrollTop !== null && scrollTop >= Math.max(0, content - viewport)) setScrollTop(null);
  });

  // Scroll the viewport by `delta` lines (negative = up into history).
  // Follow mode is scrollTop === null; scrolling up pins the view, and
  // scrolling back down to the bottom resumes following.
  const scrollBy = (delta: number) => {
    const { content, viewport } = sizeRef.current;
    const maxTop = Math.max(0, content - viewport);
    if (maxTop === 0) return;
    const current = scrollTop ?? maxTop;
    const next = Math.max(0, Math.min(maxTop, current + delta));
    setScrollTop(next >= maxTop ? null : next);
  };

  // Snapshot the session to the autosave slot, then exit. Shared by /exit,
  // /quit, and the SIGINT/SIGTERM handlers so the conversation always resumes
  // on next launch. A second signal bypasses the snapshot and force-quits.
  async function quit() {
    if (quittingRef.current) return;
    quittingRef.current = true;
    try {
      // Cancel any in-flight turn so snapshot() doesn't block on it.
      if (status === "streaming") cancel();
      const session = await agent.snapshot();
      // Skip the autosave when there's nothing to resume — keeps a first run
      // a true fresh start and avoids a stale restore later.
      if (session.turns && session.turns.length > 0) {
        await saveSession(AUTOSAVE_NAME, entry.id, session).catch(() => {});
      }
    } catch {
      // Snapshot failure shouldn't trap the user — exit anyway.
    }
    exit();
  }
  const forceQuit = () => process.exit(0);

  // Keep a stable ref to the latest quit so mount-once signal handlers call the
  // current version (not a stale closure). A second signal force-quits.
  const quitRef = useRef(() => void quit());
  quitRef.current = () => void quit();

  useEffect(() => {
    const onSignal = () => {
      if (quittingRef.current) forceQuit();
      else quitRef.current();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    return () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    };
  }, []);

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
      // The viewport re-renders wholesale from the new turns — no screen
      // wiping or remounting needed, the next frame simply is the new state.
      const nextAgent = createAgent(loadedEntry, session);
      setAgent(nextAgent);
      setEntry(loadedEntry);
      reset({ turns: session.turns, sessionAnnotations: session.sessionAnnotations });
      setScrollTop(null);
      setFilled(roughLines(session.turns) >= rows);
      setNotice(`Loaded "${name}" (${loadedEntry.label}).`);
    } catch (error) {
      setNotice(`Load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function doListSessions() {
    const names = await listSessions();
    setNotice(names.length ? `Saved sessions: ${names.join(", ")}` : "No saved sessions.");
  }

  async function doClear() {
    setNotice(null);
    try {
      // Cancel any in-flight turn so snapshot/archive reflects a settled state.
      if (status === "streaming") cancel();
      // Persist the live conversation to __current__ first, so the rotation
      // archives the actual session rather than whatever was last autosaved.
      const session = await agent.snapshot();
      if (session.turns && session.turns.length > 0) {
        await saveSession(AUTOSAVE_NAME, entry.id, session).catch(() => {});
      }
      const archiveName = await rotateCurrentSession();
      const nextAgent = createAgent(entry);
      setAgent(nextAgent);
      reset({ turns: [], sessionAnnotations: [] });
      setScrollTop(null);
      setFilled(false);
      setNotice(archiveName ? `Session archived as ${archiveName} and cleared.` : "Cleared. (Nothing to archive.)");
    } catch (error) {
      setNotice(`Clear failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const onSubmit = (value: string) => {
    if (status === "streaming" || switching || compacting) return;
    const trimmed = value.trim();
    setInput("");
    // Sending always returns the view to the bottom.
    setScrollTop(null);

    if (trimmed === "/exit" || trimmed === "/quit") {
      void quit();
      return;
    }
    if (trimmed === "/model") {
      setNotice(null);
      setMode("picker");
      return;
    }
    if (trimmed === "/compact" || trimmed.startsWith("/compact")) {
      const focusPrompt = trimmed.slice("/compact".length).trim();
      setNotice(null);
      setCompacting(true);
      if (focusPrompt) {
        try {
          getCompactionFocus(agent).prompt = focusPrompt;
        } catch {
          // Older agent without a focus holder — proceed without a prompt.
        }
      }
      agent
        .compact()
        .then((record) =>
          setNotice(record ? `Context compacted${focusPrompt ? ` (focus: ${focusPrompt})` : ""}.` : "Nothing to compact yet."),
        )
        .catch((error) =>
          setNotice(`Compact failed: ${error instanceof Error ? error.message : String(error)}`),
        )
        .finally(() => {
          try {
            getCompactionFocus(agent).prompt = undefined;
          } catch {
            // ignore
          }
          setCompacting(false);
        });
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
    if (trimmed === "/load") {
      setNotice(null);
      listSessions().then((names) => {
        if (names.length === 0) {
          setNotice("No saved sessions. Use /save <name> to create one.");
        } else {
          setSessionNames(names);
          setMode("sessions");
        }
      });
      return;
    }
    if (trimmed.startsWith("/load ")) {
      void doLoad(trimmed.slice("/load ".length).trim() || "session");
      return;
    }
    if (trimmed === "/sessions") {
      void doListSessions();
      return;
    }
    if (trimmed === "/clear") {
      void doClear();
      return;
    }
    if (trimmed === "/version") {
      setNotice(formatVersion());
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
      setNotice(`Unknown command: ${trimmed.split(/\s/)[0]} · try /model /compact /save /load /clear /version /exit`);
      return;
    }
    setNotice(null);
    send(trimmed);
  };

  const busy = status === "streaming" || switching || compacting;

  // One fixed page (the alternate screen has no scrollback): a clipping
  // viewport over the full in-memory transcript, then the chrome docked below.
  //
  // - Shorter than the viewport: content top-flows; the viewport's leftover
  //   space keeps the chrome on the last lines.
  // - Filled, following (scrollTop null): justifyContent="flex-end" anchors
  //   the newest lines to the bottom and clips history off the top — pure
  //   layout, so streaming never lags or flashes.
  // - Pinned (scrollTop set): a negative top margin slides the transcript
  //   down inside the clip window, revealing older lines; new content keeps
  //   appending below, out of view, until PgDn/Esc resumes following.
  return (
    <Box flexDirection="column" height={rows}>
      <Box
        ref={viewportRef}
        flexGrow={1}
        flexDirection="column"
        overflowY="hidden"
        justifyContent={filled && scrollTop === null ? "flex-end" : "flex-start"}
      >
        <Box
          ref={contentRef}
          flexDirection="column"
          flexShrink={0}
          marginTop={scrollTop !== null ? -scrollTop : 0}
        >
          {turns.map((turn) => (
            <TurnView key={turn.id} turn={turn} />
          ))}
        </Box>
      </Box>

      <Box flexDirection="column" flexShrink={0}>
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
      ) : mode === "sessions" ? (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text color="cyan">Load a session (↑/↓, Enter to load, Esc to cancel):</Text>
          <SelectInput
            items={sessionNames.map((name) => ({ label: name, value: name, key: name }))}
            limit={12}
            onSelect={(item) => {
              setMode("input");
              void doLoad(item.value);
            }}
          />
        </Box>
      ) : null}

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

      {scrollTop !== null ? (
        <Text dimColor>── scrolled · PgDn/↓ to bottom · Esc to follow ──</Text>
      ) : null}

      <GenerationTimer active={status === "streaming"} />

      {mode === "input" ? (
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
                      <Text color="cyan">{s.name}</Text>
                      {s.desc ? <Text>  {s.desc}</Text> : null}
                    </Box>
                  ))}
                  <Text>
                    Tab to complete
                  </Text>
                </Box>
              ) : null}
            </>
          )}
        </Box>
      ) : null}

      <StatusBar
        entry={entry}
        context={context}
        sessionUsage={sessionUsage}
        hint="/model · /compact · /save · /load · /clear · /version · /exit"
      />
      </Box>
    </Box>
  );
}
