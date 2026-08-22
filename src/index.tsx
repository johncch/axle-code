import { render } from "ink";
import React from "react";
import { makeAgentFactory } from "./agent.js";
import { readConfig, readSettings } from "./config.js";
import { buildCatalog, defaultEntry, findEntry } from "./models.js";
import { AUTOSAVE_NAME, loadSession, type SavedSessionFile } from "./session.js";
import { codingTools } from "./tools/index.js";
import { App } from "./ui/App.js";
import { applyThemeOverrides } from "./ui/theme.js";

const catalog = buildCatalog();
const config = await readConfig();
// Theme must be settled before the first render — components read the theme
// singleton at render time, so this mutates it before any frame is drawn.
// Settings also carry compaction tuning, which the agent factory consumes.
const settings = await readSettings();
applyThemeOverrides(settings.theme ?? {});
const initialEntry = defaultEntry(catalog, config.defaultModel);
const createAgent = makeAgentFactory({ tools: codingTools, compaction: settings.compaction });

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
    initialTurns={resume?.turns}
  />,
  {
    exitOnCtrlC: false,
    alternateScreen: true,
    // Enhanced key reporting: Shift+Enter becomes a real `key.return + shift`
    // event instead of a raw `CSI 27;2;13~`, and Esc arrives as `CSI 27u`,
    // which skips Ink's 20ms wait-and-see timer for a bare escape byte.
    //
    // "enabled" rather than "auto": auto probes with `CSI ?u` from Ink's
    // constructor, before `useInput` puts stdin in raw mode, so the terminal's
    // reply sits in the line-discipline buffer until after the 200ms detection
    // window — then leaks into the prompt as a literal "[?0u". Enabling
    // unconditionally sends no probe; terminals without support simply ignore
    // the enable sequence, and TextInput keeps its legacy decode for them.
    kittyKeyboard: { mode: "enabled", flags: ["disambiguateEscapeCodes"] },
  },
);
