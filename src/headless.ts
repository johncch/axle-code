import { TurnAccumulator } from "@fifthrevision/axle/ui";
import type { TurnEvent } from "@fifthrevision/axle/ui";
import { buildAgent } from "./agent.js";
import { formatGenerateError } from "./format.js";
import { codingTools } from "./tools/index.js";

const prompt =
  process.argv.slice(2).join(" ") ||
  "Read the file package.json and tell me the name and scripts defined in it.";

const { agent, model, providerLabel } = buildAgent({ tools: codingTools });

// The TUI will fold the same public event stream through its own accumulator.
// Here we do it headlessly to smoke-test the contract end to end.
const accumulator = new TurnAccumulator();

function describe(event: TurnEvent): string {
  switch (event.type) {
    case "text:delta":
      return `text:delta ${JSON.stringify(event.delta)}`;
    case "thinking:delta":
      return `thinking:delta ${JSON.stringify(event.delta)}`;
    case "action:args-delta":
      return `action:args-delta ${JSON.stringify(event.delta)}`;
    case "part:start":
      return `part:start ${event.part.type}${
        event.part.type === "action" ? ` (${event.part.detail.name})` : ""
      }`;
    case "action:progress":
      return `action:progress ${JSON.stringify(event.chunk.slice(0, 40))}`;
    case "action:complete":
      return `action:complete ${event.result.type}`;
    case "turn:end":
      return `turn:end ${event.status} in=${event.usage.in} out=${event.usage.out}`;
    default:
      return event.type;
  }
}

agent.on((event) => {
  accumulator.apply(event);
  console.log(`  ▸ ${describe(event)}`);
});

console.log(`[axle-code] provider=${providerLabel} model=${model}`);
console.log(`[prompt] ${prompt}\n`);

try {
  const result = await agent.send(prompt).final;
  console.log("\n[events folded into accumulator] final turns:");
  for (const turn of accumulator.state.turns) {
    const kinds = turn.parts.map((p) => p.type).join(", ");
    console.log(`  • ${turn.owner} turn (${turn.status}): [${kinds}]`);
  }
  if (result.ok) {
    console.log(`\n[response]\n${result.response}`);
    console.log(`\n[usage] in=${result.usage.in} out=${result.usage.out}`);
  } else {
    console.log(`\n[error] ${formatGenerateError(result.error)}`);
  }
} catch (error) {
  console.error("\n[fatal]", error);
  process.exitCode = 1;
}
