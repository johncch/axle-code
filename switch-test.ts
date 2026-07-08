import { makeAgentFactory } from "./src/agent.js";
import { buildCatalog, defaultEntry } from "./src/models.js";
import { codingTools } from "./src/tools/index.js";

// Tests the mechanism behind the /model switcher: snapshot the conversation on
// one model, restore it onto ANOTHER (possibly cross-provider), and confirm the
// second model still has the earlier context.
const catalog = buildCatalog();
const createAgent = makeAgentFactory({ tools: codingTools });

const first = defaultEntry(catalog);
// Isolate snapshot/restore continuity with a same-provider, different-model
// switch (Anthropic Haiku → Sonnet). Cross-provider adds orthogonal noise:
// OpenAI rejects our optional() tool params (strict:true), and some enum model
// ids aren't available per-key. Both are logged separately in FINDINGS.md.
const second =
  catalog.find(
    (e) => e.providerLabel === first.providerLabel && e.id !== first.id && /sonnet/i.test(e.model),
  ) ??
  catalog.find((e) => e.providerLabel === first.providerLabel && e.id !== first.id) ??
  first;

console.log(`first  : ${first.label}`);
console.log(`second : ${second.label}\n`);

let agent = createAgent(first);
const r1 = await agent.send("Remember this secret word: PLATYPUS. Reply with just 'ok'.").final;
console.log(`[${first.providerLabel}] r1 ok=${r1.ok} →`, r1.ok ? JSON.stringify(r1.response) : r1.error);

const session = await agent.snapshot();
console.log(`\nsnapshot: ${session.messages.length} messages, ${session.turns?.length ?? 0} turns`);

agent = createAgent(second, session);
const r2 = await agent
  .send("What was the secret word I told you? Reply with just the word.")
  .final;
console.log(
  `\n[${second.providerLabel}] r2 ok=${r2.ok} →`,
  r2.ok ? JSON.stringify(r2.response) : r2.error,
);

if (r2.ok) {
  const remembered = /platypus/i.test(r2.response);
  console.log(`\ncontext carried across switch: ${remembered ? "YES ✔" : "NO ✖"}`);
}
process.exit(0);
