# Axle UI Stress-Test Findings

Rough edges, ergonomic notes, and open questions found while building a TUI
coding agent (`axle-code`) against Axle's UI contract. Each entry is a data
point for improving the `@fifthrevision/axle` + `@fifthrevision/axle/ui`
surface, not necessarily a bug.

## Legend
- 🐛 likely bug / contract gap
- 😖 ergonomic friction
- ❓ open design question

---

### ❓ Is `History.turns` redundant for event-folding hosts?
A host that folds the public `TurnEvent` stream through its own
`TurnAccumulator` reconstructs exactly the `Turn[]` the Agent already keeps in
`history.turns`. During a live session the two are duplicates. `history.turns`
still earns its place via (1) `snapshot()` persistence + restore seeding, (2)
synchronous `AgentResult.turn` / `AxleAgentAbortError.turn`, and (3) the
"engine and consumer agree by construction" invariant. Open question: should a
purely event-driven host be able to opt out of internal turn storage to avoid
paying for state it never reads?

### 😖 `AgentErrorResult.error` (`GenerateError`) has no uniform `message`
`GenerateError` is a discriminated union on `kind` (`model` | `tool` |
`parse`), and only `tool`/`parse` carry a top-level `message`; the `model`
variant nests it at `error.error.error.message`. A UI that wants "just show me
the error string" must hand-write a narrowing switch (see `src/format.ts`).
Consider exposing a `message` getter or a `formatError()` helper from the
package so every consumer doesn't reinvent it.

### ✅ (retracted) "emit chunk boundaries are arbitrary" is NOT a renderer issue
Original worry: `ctx.emit(string)` chunks arrive on arbitrary OS-pipe
boundaries, so a renderer must re-buffer to get clean lines. On inspection this
is a non-issue and the design is correct:
- `TurnAccumulator` **concatenates** progress into one growing string
  (`accumulator.ts`: `content + event.chunk`), exactly like `text:delta`. A
  snapshot renderer reads the fully reassembled `result.content` and splits
  lines itself — a normal rendering concern, not a contract gap.
- The only consumer that sees raw mid-line chunks is one that renders each
  `action:progress.chunk` independently without accumulating — a self-inflicted
  bug that would equally corrupt `text:delta`.

Real takeaway (a *tool-author* gotcha, not an Axle issue): because `emit`
faithfully passes strings through, a tool that does `buffer.toString("utf-8")`
per raw chunk can split a multi-byte UTF-8 character across reads and emit `�`.
Fixed in `src/tools/bash.ts` with `StringDecoder`. Worth a one-line doc note
for tool authors who stream binary-ish output.

### 🐛 `agent.send()` emits `turn:user` + `turn:start` synchronously → late subscribers silently lose the turn
`send()` emits `turn:user` and `turn:start` *synchronously during the call*,
before it returns. A subscriber that calls `agent.on(...)` **after** `send()`
misses those two events. Downstream, the very next events (`part:start`, etc.)
reference a `turnId` the subscriber's `TurnAccumulator` never created, so the
accumulator **silently drops them** and renders nothing — no error, no warning.

Reproduced by mounting a component that subscribes in `useEffect` and calling
`send()` synchronously right after `render()`: effects run on a later
macrotask, so the subscription attached one tick too late and the whole turn
vanished (`turns=0`) despite `send().final` resolving `ok:true`.

Why the real TUI is unaffected: it subscribes at mount and only sends later
from user input, so the subscription is always attached first. But this is a
sharp edge worth hardening:
- **Contract:** document "subscribe before you send" prominently.
- **Robustness:** consider having `TurnAccumulator.apply` signal (not silently
  swallow) events that reference an unknown `turnId`, so a mis-ordered consumer
  fails loudly instead of rendering blank.
- **Ergonomics:** an `agent.on(cb, { replay: true })` that immediately replays
  current turn state (like `session:restore`) would make late subscription safe
  and support components that mount mid-conversation.

### 🐛 OpenAI provider hardcodes `strict: true` → any `z.optional()` tool param is rejected
Building the `/model` switcher (cross-provider) surfaced this: switching to any
OpenAI model 400s at request time:
```
Invalid schema for function 'edit_file': 'required' is required to be … an
array including every key in properties. Missing 'replace_all'.
```
`packages/axle/src/providers/openai/utils.ts` sets `strict: true` and passes
`z.toJSONSchema(tool.schema)` verbatim. OpenAI strict mode requires **every**
property in `required`; Zod `.optional()` omits the key, so it's rejected. This
means *any* tool with an optional parameter is unusable on OpenAI, with no
escape hatch (no way to disable strict, no schema normalization). Our
`edit_file` (`replace_all?`), `bash` (`timeout_ms?`), `list_dir` (`path?`), and
`grep` (`glob?`, `ignore_case?`) all trip it. Options for Axle: normalize
optionals to `nullable + required` for OpenAI strict mode (the documented
workaround), or expose a per-provider/`per-tool` `strict` toggle.

**Notable contrast:** the same tools work fine over **OpenRouter via
`chatCompletions`** (verified with GLM 5.2, DeepSeek V4 Pro, Qwen 3.7 Max,
MiniMax M3 — all returned `ok` with a tool `action` part). So `chatCompletions`
does *not* force `strict:true`; the rejection is specific to the native OpenAI
provider. The inconsistency between two OpenAI-shaped providers is itself worth
reconciling.

### ℹ️ OpenRouter reasoning models surface `thinking` parts via `chatCompletions`
GLM 5.2 / DeepSeek V4 Pro / Qwen 3.7 Max / MiniMax M3 all returned turns with
`thinking` parts (`[thinking,action,thinking,text]`) with no explicit
`reasoning:true`. Good news for stress-testing thinking-part rendering in Batch
4 — we don't need a special reasoning toggle to see the `thinking:delta` path
exercised; these models emit it by default.

### ✅ Same-provider snapshot/restore preserves conversation across a model switch
The switcher rebuilds the Agent (model is `readonly`; no per-send override) and
restores `agent.snapshot()` into `new Agent(config, session)`. Verified
(`switch-test.ts`): a fact taught to Haiku was recalled by Sonnet after the
switch (`context carried across switch: YES ✔`), with the UI's own accumulator
keeping scrollback intact. This is the intended and working path.

### 😖 Model enums list ids that aren't available for a given key
`Object.values(GeminiModels)` includes `gemini-3.5-pro`, which 404s ("Not
Found") for the configured key while `gemini-3.5-flash` (the default) works. A
naive "list every enum value" catalog (what the switcher does) therefore
contains dead entries. Not an Axle bug per se, but a reminder that the `Models`
enums are a superset of what any single account/key can call — a UI that
enumerates them needs to tolerate per-model availability errors (ours does:
the failed send surfaces as an error turn, no crash).

### 🐛 Turn-level (model) error message is not in the turn/event fold — only in `send()`'s result
A turn that fails at the model level gets `status: "error"` (via `turn:end`),
but the *message* is dropped: `TurnAccumulator`'s `case "error"` does
`return this.handled(event)` without storing `event.error` anywhere, and the
`Turn` type has no error field. Tool-level errors *are* retained (in
`ActionResult`), but a model/provider error is not. Consequence: a renderer that
folds only the event stream can show **that** a turn errored but not **why** —
to display the reason you must separately capture `AgentErrorResult.error` from
`send().final` (which is exactly what `useAgent` does via `lastError`). For a
pure event-driven/remote UI (no access to the send result), the error reason is
unrecoverable. Suggest either storing the error on the turn (a `Turn.error?`
field) or having the accumulator attach the last `error` event to the active
turn.

### 😖 `ContextUsage.limit` is never populated → UIs can't show "% of context used"
`agent.context()` returns `total` reliably but `limit`/`free` only when a
`limit` is passed into `estimateContextUsage`, which the Agent never does (it
has no model→context-window table). So a status bar can show `~1.4k tok` but not
`1.4k/200k (1%)` without the UI maintaining its own per-model window sizes.
A model-metadata lookup (context window per model id) exposed from Axle would
let every consumer render a real usage gauge.

### ✅ Cancel via `Handle.cancel()` is clean and abort is distinguishable
`agent.send(...).cancel()` mid-stream marks the agent turn `cancelled` (not
`error`), resolves the queue so the next send works, and rejects `final` with
`AxleAgentAbortError` — a distinct type, so a UI can suppress it rather than
show it as a failure. Verified end to end (`useAgent` + Esc). Good ergonomics.

### ✅ Subagent nesting via `createAgentTool` → `action:child-event` renders cleanly
`createAgentTool` subscribes to the child (`agent.on → ctx.emit({type:"turn-event"})`)
**before** sending, so no child events are lost (contrast the top-level
subscribe-before-send hazard above). The accumulator folds them into
`SubagentAction.detail.children`, and rendering child `Turn[]` recursively
(ActionBlock ↔ TurnView) "just works" — nested tool calls, thinking, and text
all appear under the parent action. This is the answer to the earlier "when to
emit a turn-event chunk" question: a tool hosting a nested agent.

### ✅ Compaction (@experimental) works; the validator only enforces tool-call pairing
`onCompaction` + `compact()` emit `compaction:start`/`end`, fold into a
`CompactionPart`, and shrink history — verified a 2-message history collapse to
1 summary message with the key fact still recalled afterward.
`validateCompactedMessages` only checks tool-call/result pairing (not role
alternation or a leading user message), so returning a single summary `user`
message is always valid — handy, but under-documented.

### 😖 No Agent API to emit host annotations into persisted state
Annotations are first-class in the event/turn model, but there's no
`agent.annotate(...)` — a host emits them only into its *own* accumulator (we
added `useAgent.applyEvent`). Consequence: host annotations are **not** captured
by `agent.snapshot()` (which reads `history.sessionAnnotations`, populated only
by events that flow through the agent), so they don't survive `/save`→`/load`
unless the host persists them separately. Either an Agent-level annotation emit
API, or docs clarifying "annotations are host-owned; persist them yourself,"
would close the gap.

### 😖 `AgentSession` omits provider/model, so restoring the right model is the host's job
By design `AgentSession` carries no executable config (no provider/model). So
`/save` must persist the model id alongside the session (our `SavedSessionFile`
stores `modelId`) and `/load` must map it back to a provider — otherwise a
restored conversation silently resumes on whatever the default model is. Sensible
separation, but a one-line note in the snapshot/restore docs would save every
host from rediscovering it.

### ✅ (answered) When to emit `{type:"turn-event"}` vs a plain string
Resolved while building subagents: the **string** variant (`action:progress`)
is for raw progress text; the **`{type:"turn-event"}`** variant
(`action:child-event`) is for a tool that hosts a nested agent and forwards the
child's events. `createAgentTool` is the canonical producer. Still worth a doc
example, since the boundary isn't obvious from the `ToolProgressChunk` type
alone.
