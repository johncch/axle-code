import { render } from "ink";
import React from "react";
import { makeAgentFactory } from "./agent.js";
import { readConfig } from "./config.js";
import { buildCatalog, defaultEntry, findEntry } from "./models.js";
import { AUTOSAVE_NAME, loadSession, type SavedSessionFile } from "./session.js";
import { codingTools } from "./tools/index.js";
import { App } from "./ui/App.js";

const catalog = buildCatalog();
const config = await readConfig();
const initialEntry = defaultEntry(catalog, config.defaultModel);
const createAgent = makeAgentFactory({ tools: codingTools });

// Try to resume the last session. If there's an autosave, we adopt its model
// (if still available) and session so the conversation picks up where it left
// off. Any failure — missing file, parse error — is treated as a fresh start.
let resume: SavedSessionFile | null = null;
try {
  resume = await loadSession(AUTOSAVE_NAME);
} catch {
  resume = null;
}

const startEntry = resume ? (findEntry(catalog, resume.modelId) ?? initialEntry) : initialEntry;

render(
  <App
    catalog={catalog}
    initialEntry={startEntry}
    createAgent={createAgent}
    initialSession={resume?.session}
  />,
  { exitOnCtrlC: false, alternateScreen: true },
);

