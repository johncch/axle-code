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

## Install it globally (run from anywhere)

The `bin/` launcher runs the TUI (via the bundled `tsx`, no build step) against
whatever directory you invoke it from. Link it with pnpm:

```bash
pnpm setup            # one-time: creates pnpm's global bin dir + adds it to PATH
                      # (edits your shell profile; open a new shell afterward)
pnpm link --global    # registers `axle-code` from this working tree
```

Then `axle-code` from any project. Because it links the working tree, edits to
`src/` take effect on the next launch — no rebuild. Undo with
`pnpm uninstall --global axle-code`.

## Configuration (`~/.axle/`)

For use outside this repo, put a global credentials + config there:

- **`~/.axle/credentials`** — provider keys in `.env` syntax:
  ```
  ANTHROPIC_API_KEY=...
  OPENAI_API_KEY=...
  GEMINI_API_KEY=...
  OPENROUTER_API_KEY=...
  ```
  Any one of these enables the matching models.
- **`~/.axle/models.json`** or **`.axle/models.json`** — optional JSON array of
  model spec strings to override the built-in model list. The local
  `.axle/models.json` (relative to CWD) takes precedence over the global
  `~/.axle/models.json`. See [Models](#models) below.
- **`~/.axle/config.json`** — preferences; currently `{ "defaultModel": "…" }`.
  The TUI writes this whenever you switch models, so the next launch resumes on
  your last model.
- **`.axle/settings.json`** or **`~/.axle/settings.json`** — hand-edited user
  settings, layered (local `.axle/` wins on conflicts, global fills the rest).
  Currently supports `theme` token overrides and auto-compaction tuning:
  ```json
  {
    "theme": { "accent": "green", "faint": "gray:dim" },
    "compaction": { "threshold": 100000, "target": 30000 }
  }
  ```
  `thresholdTokens` is the estimated context size at which auto-compaction
  triggers before a turn; `targetTokens` is what it shrinks toward. Omit a
  block (or an individual key) to keep the defaults. A broken file or a bad
  value is ignored — never blocks launch.

Key precedence (first found wins): a local `axle-code/.env`, then
`~/.axle/credentials`. Start model precedence: `AXLE_CODE_MODEL` env → saved
`defaultModel` → an Anthropic model.

## Using the TUI

Type a request at the `❯` prompt. The agent can read, write, and edit files,
run shell commands, and search the working directory. Typing `/` lists the
slash commands below the prompt; press **Tab** to complete (fully when one
matches, else to the shared prefix).

| Command | Action |
|---------|--------|
| `/model` | open an arrow-key model picker |
| `/model <substr>` | switch model directly (e.g. `/model glm`, `/model sonnet`) |
| `/compact` | summarize + shrink the conversation (also runs automatically before each turn when context is high) |
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

The model catalog is a flat list of spec strings. By default a built-in list
is used; you can override it by creating a `models.json` file in either:

- **`.axle/models.json`** — project-local (relative to where you run `axle-code`)
- **`~/.axle/models.json`** — global

The local file takes precedence if both exist.

```json
[
  "anthropic/claude-sonnet-5",
  "openai/gpt-5.4",
  "gemini/gemini-3.5-flash",
  "z-ai/glm-5.2",
  "deepseek/deepseek-v4-pro"
]
```

Each entry is either `"<provider>/<model-name>"` or just `"<model-name>"`:

- If the prefix is `anthropic`, `openai`, or `gemini`, it's treated as the
  provider and the rest as the model name.
- **Anything else** falls back to **openrouter** and the full string is sent
  as the model name (e.g. `z-ai/glm-5.2`, `deepseek/deepseek-v4-pro`, or even
  a bare `some-model` with no slash).

The provider determines which API key is used:

- `anthropic`  → `ANTHROPIC_API_KEY`
- `openai`     → `OPENAI_API_KEY`
- `gemini`     → `GEMINI_API_KEY`
- openrouter   → `OPENROUTER_API_KEY`

Models whose provider key is missing are shown grayed out in the picker.
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
| `src/env.ts`, `src/config.ts`, `src/models.ts` | key/credentials loading, `~/.axle/` prefs, the model catalog |
| `bin/axle-code.mjs` | global launcher (runs the TUI against the current dir) |
| `src/agent.ts` | agent factory (system prompt, tools, `PromptCompactor` auto-compaction) |
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
pnpm test         # unit tests (vitest, in test/)
pnpm typecheck    # tsc --noEmit
```

Tests drive ink-testing-library's mock stdin, which proves the component reacts
to a given key encoding but not that your terminal emits it — check keybindings
in a real TTY with `pnpm dev`.
