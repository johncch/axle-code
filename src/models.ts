import { anthropic, chatCompletions, gemini, openai } from "@fifthrevision/axle";
import type { AIProvider } from "@fifthrevision/axle";
import { loadEnv } from "./env.js";

export interface ModelEntry {
  /** Stable unique id, e.g. "anthropic:claude-sonnet-5". */
  id: string;
  providerLabel: string;
  model: string;
  /** Undefined when the provider's key is missing (entry is unavailable). */
  provider?: AIProvider;
  /** Env var that supplies this provider's key. */
  keyEnv: string;
  label: string;
  /** True when the provider key is set, so the model can actually be used. */
  available: boolean;
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
    models: ["gemini-3.5-flash"],
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
 * Build the full model catalog. Every provider's models are listed; those whose
 * key is missing are marked `available: false` (no provider instance) so the UI
 * can show them grayed out. One provider instance is shared across its models.
 */
export function buildCatalog(): ModelEntry[] {
  loadEnv();
  const entries: ModelEntry[] = [];
  for (const spec of PROVIDERS) {
    const key = process.env[spec.keyEnv];
    const provider = key ? spec.make(key) : undefined;
    for (const model of spec.models) {
      entries.push({
        id: `${spec.label}:${model}`,
        providerLabel: spec.label,
        model,
        provider,
        keyEnv: spec.keyEnv,
        label: `${spec.label} · ${model}`,
        available: Boolean(key),
      });
    }
  }
  if (!entries.some((e) => e.available)) {
    throw new Error(
      "No provider API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or " +
        "OPENROUTER_API_KEY in axle-code/.env or ~/.axle/credentials.",
    );
  }
  return entries;
}

/**
 * Pick the starting model, in precedence order:
 *   1. AXLE_CODE_MODEL env var  — one-off override
 *   2. savedModelId             — the last model persisted to ~/.axle/config.json
 *   3. an Anthropic model, else the first available entry
 */
export function defaultEntry(catalog: ModelEntry[], savedModelId?: string): ModelEntry {
  const available = catalog.filter((e) => e.available);
  const preferred = process.env.AXLE_CODE_MODEL;
  if (preferred) {
    const match = available.find((e) => e.model === preferred || e.id.endsWith(preferred));
    if (match) return match;
  }
  if (savedModelId) {
    const match = available.find((e) => e.id === savedModelId);
    if (match) return match;
  }
  return available.find((e) => e.providerLabel === "anthropic") ?? available[0];
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
