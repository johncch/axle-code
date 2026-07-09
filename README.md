# axle-code

A proof-of-concept terminal coding agent built on the [Axle](https://github.com/johncch/axle) library.
Its real purpose is to **stress-test Axle's UI contract** — the
`@fifthrevision/axle/ui` event/turn model — by driving it from a realistic
consumer: a streaming, multi-turn, tool-using TUI.

## Quick start

```bash
pnpm install          # links ../axle/packages/axle
pnpm dev              # launch the TUI
```

Provider keys are read from `axle-code/.env` if present, otherwise from
`../axle/.env`. Any of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
or `OPENROUTER_API_KEY` enables the matching models.

## Using the TUI

Type a request at the `❯` prompt. The agent can read, write, and edit files,
run shell commands, and search the working directory.

| Command | Action |
|---------|--------|
| `/model` | open an arrow-key model picker |
| `/model <substr>` | switch model directly (e.g. `/model glm`, `/model sonnet`) |
| `/compact` | summarize + shrink the conversation (compaction) |
| `/save [name]` | save the session to `.axle-code-sessions/` |
| `/load [name]` | restore a saved session (model + scrollback + history) |
| `/sessions` | list saved sessions |
| `/index` | demo a host annotation lifecycle (running → complete) |
| `/exit`, `/quit` | quit |
| `Esc` | cancel the in-flight turn (or close the picker) |
| `Ctrl+C` | quit |

Switching models mid-conversation carries the history across via
`snapshot()`/restore. See `FINDINGS.md` for the UI-contract notes gathered while
building this (several were fixed in Axle 0.26.1, incl. cross-provider tool
schemas and turn-level error surfacing).

## Models

The catalog is defined in one place — the `PROVIDERS` array in
[`src/models.ts`](./src/models.ts) — and only includes providers whose key is
set:

- **anthropic** · `claude-sonnet-5`
- **openai** · `gpt-5.4`
- **gemini** · `gemini-3.5-flash`
- **openrouter** (via `chatCompletions`) · `z-ai/glm-5.2`,
  `deepseek/deepseek-v4-pro`, `qwen/qwen3.7-max`, `minimax/minimax-m3`

Override the default with `AXLE_CODE_MODEL=<substr>`.

## How it consumes Axle

The core pattern: subscribe to the agent's event stream and fold it through our
**own** `TurnAccumulator` into React state — the same path a remote/wire UI
would use, rather than reading Axle's internal turn state.

```
agent.on(event)  →  TurnAccumulator.apply(event)  →  React state  →  Ink render
```

Key files:

| File | Role |
|------|------|
| `src/env.ts`, `src/models.ts` | key detection + the model catalog |
| `src/agent.ts` | agent factory (system prompt, tools, compaction callback) |
| `src/compaction.ts` | `onCompaction` policy (summarize → one message) |
| `src/session.ts` | `/save` + `/load` via `agent.snapshot()` |
| `src/tools/*` | coding tools (`read`, `write`, `edit`, `ls`, `glob`, `grep`, `bash`, `explore`) |
| `src/ui/useAgent.ts` | event stream → `TurnAccumulator` → React; `send`/`cancel`/`reset` |
| `src/ui/App.tsx` | layout, input, slash-commands, model switching |
| `src/ui/TurnView.tsx`, `ActionBlock.tsx` | render turns, parts, and nested subagent turns |
| `src/ui/StatusBar.tsx`, `AnnotationBar.tsx` | context/token usage; host annotations |

## Axle UI surfaces exercised

| Surface | Where |
|---------|-------|
| Streaming text (`text:delta`) | `TurnView` text parts |
| Thinking (`thinking:delta`) | `TurnView` — visible with OpenRouter reasoning models |
| Tool lifecycle (`action:*`) + streaming args | `ActionBlock`; `bash` streams via `ctx.emit` |
| Subagents (`action:child-event`) | `explore` tool → nested `Turn[]` in `ActionBlock` |
| Compaction (`compaction:*`) | `/compact` → `CompactionPart` |
| Annotations (`annotation:*`) | `/index`, workspace banner → `AnnotationBar` |
| Cancellation | `Esc` → `Handle.cancel()` → `cancelled` turn |
| Snapshot / restore | model switch, `/save`, `/load` |
| Context + token usage | `agent.context()` + turn `usage` → `StatusBar` |

## Dev scripts

```bash
pnpm dev          # interactive TUI (needs a real TTY)
pnpm headless "…" # drive one turn, log the event stream + accumulated turns
pnpm smoke "…"    # render <App> via ink-testing-library, print the final frame
                  #   SMOKE_MODEL=glm pnpm smoke "…"  picks a model by substring
pnpm typecheck    # tsc --noEmit
tsx switch-test.ts # verify session continuity across a model switch
```

`pnpm smoke` drives the agent directly (ink-testing-library's mock stdin has no
raw mode, so `TextInput` can't be typed into) — use it to inspect rendered
output non-interactively.
