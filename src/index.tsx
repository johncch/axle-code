import { render } from "ink";
import React from "react";
import { makeAgentFactory } from "./agent.js";
import { buildCatalog, defaultEntry } from "./models.js";
import { codingTools } from "./tools/index.js";
import { App } from "./ui/App.js";

const catalog = buildCatalog();
const initialEntry = defaultEntry(catalog);
const createAgent = makeAgentFactory({ tools: codingTools });

render(
  <App
    catalog={catalog}
    initialEntry={initialEntry}
    createAgent={createAgent}
  />,
);
