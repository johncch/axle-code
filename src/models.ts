import { anthropic, chatCompletions, gemini, openai } from "@fifthrevision/axle";
import type { AIProvider } from "@fifthrevision/axle";
import { loadEnv } from "./env.js";

export interface ModelEntry {
  /** Stable unique id, e.g. "anthropic:claude-sonnet-5". */
  id: string;
  providerLabel: string;
  model: string;
  provider: AIProvider;
  label: string;
}

interface ProviderSpec {
  label: string;
  keyEnv: string;
  make: (key: string) => AIProvider;
  /** Curated model slugs to expose in the switcher, in display order. */
  models: string[];
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const PROVIDERS: ProviderSpec[] = [
  {
    label: "anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    make: anthropic,
    models: ["claude-sonnet-5"],
  },
  {
    label: "openai",
    keyEnv: "OPENAI_API_KEY",
    make: openai,
    models: ["gpt-5.4"],
  },
  {
    label: "gemini",
    keyEnv: "GEMINI_API_KEY",
    make: gemini,
    models: ["gemini-3.5-flash", "gemini-3.5-pro"],
  },
  {
    label: "openrouter",
    keyEnv: "OPENROUTER_API_KEY",
    make: (key) => chatCompletions(OPENROUTER_BASE_URL, key, { vendor: "openrouter" }),
    models: [
      "z-ai/glm-5.2",
      "deepseek/deepseek-v4-pro",
      "qwen/qwen3.7-max",
      "minimax/minimax-m3",
    ],
  },
];

/**
 * Build the list of selectable models from whichever provider keys are present.
 * One provider instance is created per provider and shared across its models.
 */
export function buildCatalog(): ModelEntry[] {
  loadEnv();
  const entries: ModelEntry[] = [];
  for (const spec of PROVIDERS) {
    const key = process.env[spec.keyEnv];
    if (!key) continue;
    const provider = spec.make(key);
    for (const model of spec.models) {
      entries.push({
        id: `${spec.label}:${model}`,
        providerLabel: spec.label,
        model,
        provider,
        label: `${spec.label} · ${model}`,
      });
    }
  }
  if (entries.length === 0) {
    throw new Error(
      "No provider API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or " +
        "OPENROUTER_API_KEY in axle-code/.env or ../axle/.env.",
    );
  }
  return entries;
}

/** Pick a sensible default: an Anthropic model if available, else the first entry. */
export function defaultEntry(catalog: ModelEntry[]): ModelEntry {
  const preferred = process.env.AXLE_CODE_MODEL;
  if (preferred) {
    const match = catalog.find((e) => e.model === preferred || e.id.endsWith(preferred));
    if (match) return match;
  }
  return catalog.find((e) => e.providerLabel === "anthropic") ?? catalog[0];
}

/** Find an entry by case-insensitive substring against its id/model/label. */
export function findEntry(catalog: ModelEntry[], query: string): ModelEntry | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return (
    catalog.find((e) => e.model.toLowerCase() === q || e.id.toLowerCase() === q) ??
    catalog.find((e) => e.id.toLowerCase().includes(q) || e.label.toLowerCase().includes(q))
  );
}
