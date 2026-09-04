import { render } from "ink";
import React from "react";
import { makeAgentFactory } from "./agent.js";
import { loadConfig } from "./config.js";
import { buildCatalog, defaultEntry, findEntry } from "./models.js";
import { AUTOSAVE_NAME, loadSession, type SavedSessionFile } from "./session.js";
import { codingTools } from "./tools/index.js";
import { App } from "./ui/App.js";
import { applyThemeOverrides } from "./ui/theme.js";

// One config file: ~/.axle/code.yaml layered with the project-local
// .axle/code.yaml (local wins). Carries prefs, the model list, theme and
// compaction tuning — the previous code.json/settings.json/models.json trio
// is still honored as a legacy fallback.
const config = loadConfig();
const { entries: catalog, warnings: catalogWarnings } = buildCatalog(config);
// Theme must be settled before the first render — components read the theme
// singleton at render time, so this mutates it before any frame is drawn.
applyThemeOverrides(config.theme ?? {});
const { entry: initialEntry, warnings: modelWarnings } = defaultEntry(catalog, config.defaultModel);
const startupWarnings = [...catalogWarnings, ...modelWarnings];
const createAgent = makeAgentFactory({ tools: codingTools, compaction: config.compaction });

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
    initialNotice={startupWarnings.length ? startupWarnings.join(" · ") : undefined}
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
