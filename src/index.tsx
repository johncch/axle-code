import { render } from "ink";
import React from "react";
import { makeAgentFactory } from "./agent.js";
import { readConfig } from "./config.js";
import { buildCatalog, defaultEntry } from "./models.js";
import { codingTools } from "./tools/index.js";
import { App } from "./ui/App.js";

const catalog = buildCatalog();
const config = await readConfig();
const initialEntry = defaultEntry(catalog, config.defaultModel);
const createAgent = makeAgentFactory({ tools: codingTools });

render(
  <App
    catalog={catalog}
    initialEntry={initialEntry}
    createAgent={createAgent}
  />,
);
