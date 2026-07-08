import { render } from "ink-testing-library";
import React from "react";
import { makeAgentFactory } from "./src/agent.js";
import { buildCatalog, defaultEntry, findEntry } from "./src/models.js";
import { codingTools } from "./src/tools/index.js";
import { App } from "./src/ui/App.js";

// Non-interactive render harness. ink-testing-library's mock stdin has no raw
// mode, so we can't type into TextInput; we render <App> and drive a send by
// reaching the agent the same factory produces.
//   pnpm smoke "prompt"            (default model)
//   SMOKE_MODEL=glm pnpm smoke "…" (pick a model by substring)
const prompt = process.argv.slice(2).join(" ") || "Say DONE in one word.";

const catalog = buildCatalog();
const initialEntry =
  (process.env.SMOKE_MODEL ? findEntry(catalog, process.env.SMOKE_MODEL) : undefined) ??
  defaultEntry(catalog);
const createAgent = makeAgentFactory({ tools: codingTools });

// Capture the agent App builds by wrapping the factory.
let firstAgent: ReturnType<typeof createAgent> | undefined;
const wrapped = (entry: (typeof catalog)[number], session?: any) => {
  const a = createAgent(entry, session);
  if (!firstAgent) firstAgent = a;
  return a;
};

const { lastFrame } = render(
  React.createElement(App, { catalog, initialEntry, createAgent: wrapped }),
);

await new Promise((r) => setTimeout(r, 50));
await firstAgent!.send(prompt).final;

setTimeout(() => {
  console.log(`catalog: ${catalog.length} models across providers`);
  console.log("=== FINAL FRAME ===");
  console.log(lastFrame());
  process.exit(0);
}, 300);
