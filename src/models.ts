import { anthropic, chatCompletions, gemini, openai } from "@fifthrevision/axle";
import type { AIProvider } from "@fifthrevision/axle";
import { loadConfig, type AxleConfig } from "./config.js";
import { loadEnv } from "./env.js";

export interface ModelEntry {
  /** Stable unique id, e.g. "anthropic/claude-sonnet-5". */
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

// ---------------------------------------------------------------------------
// Spec parsing
// ---------------------------------------------------------------------------

interface ProviderKind {
  label: string;
  keyEnv: string;
  make: (key: string) => AIProvider;
}

const ANTHROPIC: ProviderKind = { label: "anthropic", keyEnv: "ANTHROPIC_API_KEY", make: anthropic };
const OPENAI: ProviderKind = { label: "openai", keyEnv: "OPENAI_API_KEY", make: openai };
const GEMINI: ProviderKind = { label: "gemini", keyEnv: "GEMINI_API_KEY", make: gemini };

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER: ProviderKind = {
  label: "openrouter",
  keyEnv: "OPENROUTER_API_KEY",
  make: (key) => chatCompletions(OPENROUTER_BASE_URL, key, { vendor: "openrouter" }),
};

/** Registry of known providers keyed by label. */
const PROVIDERS: Record<string, ProviderKind> = {
  anthropic: ANTHROPIC,
  openai: OPENAI,
  gemini: GEMINI,
  openrouter: OPENROUTER,
};

/** First segment of a spec that maps to a built-in provider. */
const KNOWN_PROVIDERS = new Set(["anthropic", "openai", "gemini"]);

/**
 * Parse a `"provider/model"` spec string. If the first segment (before `/`) is
 * `anthropic`, `openai`, or `gemini`, it's treated as the provider and the
 * rest as the model name. Anything else — including strings with no `/` or
 * unknown prefixes like `z-ai/...` — is sent in full to openrouter as the
 * model name.
 */
function parseSpec(spec: string): { kind: ProviderKind; model: string } {
  const slash = spec.indexOf("/");
  if (slash <= 0) {
    // No provider prefix — treat the whole string as an openrouter model.
    return { kind: OPENROUTER, model: spec };
  }
  const label = spec.slice(0, slash).toLowerCase();
  if (KNOWN_PROVIDERS.has(label)) {
    const model = spec.slice(slash + 1);
    if (!model) throw new Error(`'${spec}' has an empty model name after '${label}/'.`);
    return { kind: PROVIDERS[label], model };
  }
  // Unknown prefix — the full string is the model name for openrouter.
  return { kind: OPENROUTER, model: spec };
}

// ---------------------------------------------------------------------------
// Model list loading
// ---------------------------------------------------------------------------

/** Built-in defaults used when no user models file exists. */
const DEFAULT_MODELS: string[] = [
  "anthropic/claude-sonnet-5",
  "openai/gpt-5.4",
  "gemini/gemini-3.5-flash",
  "z-ai/glm-5.2",
  "deepseek/deepseek-v4-pro",
  "qwen/qwen3.7-max",
  "minimax/minimax-m3",
  "moonshotai/kimi-k3",
];

/**
 * Load the model list from the unified config's `models` key —
 * `~/.axle/code.yaml` merged with the project-local `.axle/code.yaml`. Falls
 * back to {@link DEFAULT_MODELS} when no list is configured or the value is
 * unusable, reporting why so the caller can surface it at startup instead of
 * leaving the user on a silently different list. (Legacy `models.json` files
 * are still picked up — config loading folds them in.)
 */
function loadModelSlugs(config: AxleConfig): { slugs: string[]; warnings: string[] } {
  if (config.models === undefined) {
    return {
      slugs: DEFAULT_MODELS,
      warnings: ["No models list configured — using the built-in model list."],
    };
  }
  return { slugs: config.models, warnings: [] };
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface Catalog {
  entries: ModelEntry[];
  /** Non-fatal config problems, for the caller to surface at startup. */
  warnings: string[];
}

/**
 * Build the full model catalog. Every model's provider key is checked; those
 * whose key is missing are marked `available: false` (no provider instance) so
 * the UI can show them grayed out. One provider instance is shared across
 * models from the same provider.
 */
export function buildCatalog(config?: AxleConfig): Catalog {
  loadEnv();
  const { slugs, warnings } = loadModelSlugs(config ?? loadConfig());

  // Cache one AIProvider instance per provider label.
  const providerCache = new Map<string, AIProvider | undefined>();

  const entries: ModelEntry[] = [];
  for (const spec of slugs) {
    const { kind, model } = parseSpec(spec);
    if (!providerCache.has(kind.label)) {
      const key = process.env[kind.keyEnv];
      providerCache.set(kind.label, key ? kind.make(key) : undefined);
    }
    const provider = providerCache.get(kind.label);
    entries.push({
      id: `${kind.label}/${model}`,
      providerLabel: kind.label,
      model,
      provider,
      keyEnv: kind.keyEnv,
      label: `${kind.label} · ${model}`,
      available: Boolean(provider),
    });
  }
  if (!entries.some((e) => e.available)) {
    throw new Error(
      "No provider API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or " +
        "OPENROUTER_API_KEY in axle-code/.env or ~/.axle/credentials.",
    );
  }
  return { entries, warnings };
}

/** Match a model reference against an entry's id or bare model name. */
function matchAvailable(available: ModelEntry[], ref: string): ModelEntry | undefined {
  return available.find((e) => e.model === ref || e.id === ref || e.id.endsWith("/" + ref));
}

/**
 * Pick the starting model, in precedence order:
 *   1. AXLE_CODE_MODEL env var  — one-off override
 *   2. savedModelId             — the last model persisted to ~/.axle/code.yaml
 *   3. an Anthropic model, else the first available entry
 *
 * A reference that resolves to nothing falls through to the next rule and is
 * reported, so a stale saved id doesn't quietly land you on a different model.
 */
export function defaultEntry(
  catalog: ModelEntry[],
  savedModelId?: string,
): { entry: ModelEntry; warnings: string[] } {
  const available = catalog.filter((e) => e.available);
  const warnings: string[] = [];

  const preferred = process.env.AXLE_CODE_MODEL;
  if (preferred) {
    const match = matchAvailable(available, preferred);
    if (match) return { entry: match, warnings };
    warnings.push(`AXLE_CODE_MODEL="${preferred}" matches no available model.`);
  }
  if (savedModelId) {
    const match = matchAvailable(available, savedModelId);
    if (match) return { entry: match, warnings };
    warnings.push(`Saved model "${savedModelId}" is no longer in the catalog.`);
  }

  const entry = available.find((e) => e.providerLabel === "anthropic") ?? available[0];
  if (warnings.length) warnings.push(`Started on ${entry.label}.`);
  return { entry, warnings };
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
