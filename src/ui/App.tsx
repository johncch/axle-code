import {
  Box,
  Text,
  measureElement,
  useApp,
  useInput,
  useStdout,
  useWindowSize,
  type DOMElement,
} from "ink";
import SelectInput from "ink-select-input";
import TextInput from "./TextInput.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Agent, AgentSession, ContextUsage } from "@fifthrevision/axle";
import type { Turn } from "@fifthrevision/axle/ui";
import { writeConfig } from "../config.js";
import { findEntry, type ModelEntry } from "../models.js";
import { AUTOSAVE_NAME, listSessions, loadSession, rotateCurrentSession, saveSession } from "../session.js";
import { formatVersion } from "../version.js";
import { GenerationTimer } from "./GenerationTimer.js";
import { StatusBar } from "./StatusBar.js";
import { TopBar } from "./TopBar.js";
import { TurnView } from "./TurnView.js";
import { useAgent } from "./useAgent.js";

export interface AppProps {
  catalog: ModelEntry[];
  initialEntry: ModelEntry;
  createAgent: (entry: ModelEntry, session?: AgentSession) => Agent;
  /** Restored autosave session, if any. Seeds the agent for continuation. */
  initialSession?: AgentSession;
  /** Restored transcript turns, if any. Seeds the UI on mount. */
  initialTurns?: Turn[];
}

const COMMANDS: { name: string; desc: string }[] = [
  { name: "/model", desc: "switch model (picker, or /model <substr>)" },
  { name: "/compact", desc: "summarize + shrink the conversation" },
  { name: "/save", desc: "save the session [name]" },
  { name: "/load", desc: "restore a saved session [name]" },
  { name: "/sessions", desc: "list saved sessions" },
  { name: "/clear", desc: "archive current session and start fresh" },
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

export function App({ catalog, initialEntry, createAgent, initialSession, initialTurns }: AppProps) {
  const [agent, setAgent] = useState<Agent>(() => createAgent(initialEntry, initialSession));
  const [entry, setEntry] = useState<ModelEntry>(initialEntry);
  const { turns, status, lastError, send, stop, cancel, reset, applyEvent } =
    useAgent(agent, { turns: initialTurns });
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"input" | "picker" | "sessions">("input");
  const [sessionNames, setSessionNames] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const quittingRef = useRef(false);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { rows } = useWindowSize();

  // Real mouse reporting (button tracking + SGR coordinates). Without it the
  // terminal falls back to "alternate scroll", translating the wheel into ↑/↓
  // — indistinguishable from the keys, which is why the two behaviours could
  // not be separated before. With it the wheel arrives as its own sequence.
  //
  // The cost: while tracking is on the terminal hands mouse events to us
  // instead of selecting text, so selection needs a modifier held (Shift, or
  // Option in some terminals).
  //
  // Restoring on exit matters more than usual — leaving tracking enabled means
  // the user's shell receives mouse escape codes on every scroll — so the
  // teardown is also wired to process exit, which `forceQuit`'s process.exit()
  // still runs.
  useEffect(() => {
    const disable = () => stdout.write("\x1b[?1006l\x1b[?1000l");
    stdout.write("\x1b[?1000h\x1b[?1006h");
    process.on("exit", disable);
    return () => {
      process.off("exit", disable);
      disable();
    };
  }, [stdout]);

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
  const [filled, setFilled] = useState(() => roughLines(initialTurns) >= rows);
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
      const base = agent.context();
      // agent.context() only reflects committed messages. During streaming
      // the in-progress turn's text isn't in `messagesInternal` yet, so the
      // raw value is stale until turn:end. Add a rough estimate of the
      // streaming content (same char/3 heuristic Axle uses) so the status bar
      // shows context growing live.
      const streaming = turns.find((t) => t.status === "streaming");
      if (streaming) {
        let chars = 0;
        for (const part of streaming.parts) {
          if (part.type === "text") chars += part.text.length;
          else if (part.type === "thinking")
            chars += (part.text ?? "").length + (part.summary ?? "").length;
          else if (part.type === "action")
            chars += JSON.stringify(part.detail ?? {}).length;
        }
        const extra = Math.ceil(chars / 3);
        if (extra > 0)
          return { ...base, total: base.total + extra, messages: base.messages + extra };
      }
      return base;
    } catch {
      return null;
    }
    // Recompute as turns land (history grows) or the model changes.
  }, [agent, turns]);

  const sessionUsage = useMemo(() => {
    const base = turns.reduce(
      (acc, t) => (t.usage ? { in: acc.in + t.usage.in, out: acc.out + t.usage.out } : acc),
      { in: 0, out: 0 },
    );
    // Axle only reports usage on `turn:end`, so the in-progress turn
    // contributes nothing until it settles. Estimate its tokens so the
    // status bar updates live per part:
    //   in  — the context that was sent to the model (agent.context().total)
    //   out — generated text/thinking, estimated with the same chars/3
    //         heuristic Axle uses internally.
    const streaming = turns.find((t) => t.status === "streaming");
    if (streaming) {
      let chars = 0;
      for (const part of streaming.parts) {
        if (part.type === "text") chars += part.text.length;
        else if (part.type === "thinking")
          chars += (part.text ?? "").length + (part.summary ?? "").length;
        else if (part.type === "action")
          chars += JSON.stringify(part.detail ?? {}).length;
      }
      base.out += Math.ceil(chars / 3);
      try {
        base.in += agent.context().total;
      } catch {
        // ignore — leave in unchanged
      }
    }
    return base;
  }, [agent, turns]);

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
    // Mouse wheel. Ink has no mapping for SGR mouse reports, so they arrive as
    // their literal text with the ESC stripped: `[<{button};{col};{row}M`,
    // where button 64 is wheel-up and 65 wheel-down. TextInput drops the same
    // sequences rather than typing them (see its escape-sequence guard).
    const wheel = /^\[<(64|65);\d+;\d+M$/.exec(_input);
    if (wheel) {
      scrollBy(wheel[1] === "64" ? -3 : 3);
      return;
    }
    // Viewport scrolling (tmux copy-mode-lite): PgUp/PgDn page. ↑/↓ belong to
    // the prompt's cursor, so they never scroll. Only in input mode: the
    // pickers own their own keys.
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
    }
    // Esc cancels the running turn, and does nothing else: it used to also
    // resume follow-mode, which made "Esc to follow" an invitation to kill the
    // turn by accident. PgDn returns to the bottom instead.
    if (key.escape) {
      if (mode === "picker" || mode === "sessions") {
        setMode("input");
        setNotice(null);
      } else if (status === "streaming") {
        cancel();
        setCancelling(true);
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
      if (turns.length > 0) {
        await saveSession(AUTOSAVE_NAME, entry.id, session, turns).catch(() => {});
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
      // own transcript keeps its turns, so scrollback is uninterrupted.
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
      const path = await saveSession(name, entry.id, session, turns);
      setNotice(`Saved session to ${path}`);
    } catch (error) {
      setNotice(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function doLoad(name: string) {
    try {
      const { modelId, session, turns: savedTurns } = await loadSession(name);
      const loadedEntry = findEntry(catalog, modelId) ?? entry;
      // The viewport re-renders wholesale from the new turns — no screen
      // wiping or remounting needed, the next frame simply is the new state.
      const nextAgent = createAgent(loadedEntry, session);
      setAgent(nextAgent);
      setEntry(loadedEntry);
      reset({ turns: savedTurns });
      setScrollTop(null);
      setFilled(roughLines(savedTurns) >= rows);
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
      if (turns.length > 0) {
        await saveSession(AUTOSAVE_NAME, entry.id, session, turns).catch(() => {});
      }
      const archiveName = await rotateCurrentSession();
      const nextAgent = createAgent(entry);
      setAgent(nextAgent);
      reset({ turns: [] });
      setScrollTop(null);
      setFilled(false);
      setNotice(archiveName ? `Session archived as ${archiveName} and cleared.` : "Cleared. (Nothing to archive.)");
    } catch (error) {
      setNotice(`Clear failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const onSubmit = (value: string) => {
    // User can keep typing and send steering messages while the agent is
    // working. Slash-commands that need a settled conversation are blocked
    // while a turn is active; a plain message stops the active turn at its
    // next tool-call boundary and queues itself as the next turn.
    const streaming = status === "streaming";
    if (switching || compacting) return;
    const trimmed = value.trim();
    setInput("");
    // Sending always returns the view to the bottom.
    setScrollTop(null);

    if (trimmed === "/exit" || trimmed === "/quit") {
      void quit();
      return;
    }
    // While a turn is running, commands that mutate or inspect a *settled*
    // conversation are unsafe (they'd snapshot/queue mid-stream). Allow the
    // always-safe ones; block the rest and steer the user to a plain message
    // or to stop first.
    if (streaming) {
      if (!trimmed.startsWith("/")) {
        // Steering message: stop the active turn at its next tool-call
        // boundary, then queue this message as the next turn.
        stop();
        setNotice("Pausing at next tool call — sending your message…");
        send(trimmed);
        return;
      }
      if (trimmed === "/version") {
        setNotice(formatVersion());
        return;
      }
      setNotice(
        `Wait for the agent to finish, or send a plain message to pause and queue it. (${trimmed.split(/\s/)[0]} needs an idle conversation)`,
      );
      return;
    }
    if (trimmed === "/model") {
      setNotice(null);
      setMode("picker");
      return;
    }
    if (trimmed === "/compact" || trimmed.startsWith("/compact")) {
      setNotice(null);
      setCompacting(true);
      agent
        .compact()
        .then((applied) =>
          setNotice(applied ? "Context compacted." : "Nothing to compact yet."),
        )
        .catch((error) =>
          setNotice(`Compact failed: ${error instanceof Error ? error.message : String(error)}`),
        )
        .finally(() => {
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
    if (trimmed.startsWith("/")) {
      setNotice(`Unknown command: ${trimmed.split(/\s/)[0]} · try /model /compact /save /load /clear /version /exit`);
      return;
    }
    setNotice(null);
    send(trimmed);
  };

  const busy = status === "streaming" || switching || compacting;

  // The single status message shown inline with the stopwatch. The busy
  // variants take precedence over transient notices so "Switching to X…"
  // (a notice) doesn't fight the "…switching model (input disabled)" line.
  const statusMessage = switching
    ? "…switching model (input disabled)"
    : compacting
      ? "…compacting context (input disabled)"
      : cancelling
        ? "…cancelling"
        : status === "streaming"
          ? "working — type below to pause & steer, Esc to cancel"
          : notice;

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
  //   appending below, out of view, until PgDn reaches the bottom and resumes
  //   following (sending a message does too).
  return (
    <Box flexDirection="column" height={rows}>
      <TopBar />
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

      {scrollTop !== null ? (
        <Text dimColor>── scrolled · PgDn to bottom ──</Text>
      ) : null}

      <GenerationTimer active={status === "streaming"} message={statusMessage} />

      {mode === "input" ? (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color="blue">❯ </Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={onSubmit}
              placeholder={
                busy
                  ? "Steer the agent… (sends a message, pauses at next tool call)"
                  : "Ask me… (/model to switch, /exit to quit)"
              }
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
        </Box>
      ) : null}

      <StatusBar entry={entry} context={context} sessionUsage={sessionUsage} />
      </Box>
    </Box>
  );
}
