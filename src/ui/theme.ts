/**
 * Semantic colour tokens for the whole TUI. Components reference these instead
 * of hardcoding colour literals, so the look is retunable from one place.
 *
 * HOW COLOURS RESOLVE: every token here holds a *palette name*, not an RGB
 * value. Ink turns `"cyan"` into the SGR sequence `ESC[36m`, which means
 * "paint with palette slot 6" — the terminal's own colour scheme decides what
 * RGB slot 6 actually is. Consequences:
 *
 * - Changing what "cyan" looks like is the *user's* terminal theme's job; we
 *   can't repaint slot 6 from inside the app (only truecolor/hex values bypass
 *   the palette, and they then ignore the user's scheme entirely).
 * - What we CAN change from here is which slots we point at — swapping
 *   `tool: "magenta"` to `tool: "yellow"` re-maps every tool name to a
 *   different palette slot across the app.
 *
 * TOKEN GRAMMAR: `"name"`, `"name:dim"`, or `"dim"`.
 * The `:dim` suffix (or bare `"dim"` for default-foreground text) maps to
 * Ink's `dimColor` — the SGR *faint* attribute (`ESC[2m`), not a palette
 * slot: the terminal derives it by blending the foreground toward the
 * background, and it composes with any colour. `<ThemeText>` applies both
 * halves; `resolveColor` splits a token for places that can only take a
 * colour (Box `borderColor`/`backgroundColor` have no dim attribute).
 * Hex/rgb values are also valid tokens wherever a colour is accepted.
 */
export type ColorToken = string;

export interface ThemeTokens {
  /** Brand/interactive accent: title bar, pickers, autocomplete, live timer. */
  accent: ColorToken;
  /** Foreground used on top of `accent` backgrounds. */
  onAccent: ColorToken;
  /** User-originated / actively-working marks: the `❯` prompt, live dots. */
  primary: ColorToken;
  /** Dots once their step has landed (vs. `primary` while streaming). */
  settled: ColorToken;
  /** Tool names and sub-agent child frames. */
  tool: ColorToken;
  /** Sub-agent/task headers. */
  agent: ColorToken;
  /** Transient states: cancelled turns, compaction progress, notices. */
  warning: ColorToken;
  /** Errors. */
  danger: ColorToken;
  /** Boxes and strokes around muted content (results, thinking bodies). */
  muted: ColorToken;
  /** De-emphasised default-foreground text: status bar, hints, thinking bodies. */
  faint: ColorToken;
}

/**
 * The live theme singleton. Components read it at render time, so mutations
 * made by `applyThemeOverrides` (before Ink renders) take effect everywhere
 * without touching a single component.
 */
export const theme: ThemeTokens = {
  accent: "cyan",
  onAccent: "black",
  primary: "blue",
  settled: "white",
  tool: "magenta",
  agent: "green",
  warning: "yellow",
  danger: "red",
  muted: "gray",
  faint: "dim",
};

/** Token names a settings file may override. */
export type ThemeTokenName = keyof ThemeTokens;

const TOKEN_NAMES: ReadonlySet<string> = new Set(Object.keys(theme) as ThemeTokenName[]);

/** Palette names Ink/chalk map to the terminal's 16 ANSI slots (+brights). */
const PALETTE_CANONICAL = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "gray", "grey",
  "blackBright", "redBright", "greenBright", "yellowBright",
  "blueBright", "magentaBright", "cyanBright", "whiteBright",
];
// chalk keywords are camelCase; accept any casing from settings and
// canonicalise so e.g. "magentabright" still resolves.
const PALETTE_LOOKUP = new Map(PALETTE_CANONICAL.map((n) => [n.toLowerCase(), n]));

/**
 * Validate a colour token and return it in canonical form (palette names get
 * their chalk-approved casing back); null when malformed.
 */
function normalizeToken(value: string): ColorToken | null {
  const sep = value.indexOf(":");
  const base = (sep === -1 ? value : value.slice(0, sep)).trim();
  const suffix = sep === -1 ? "" : value.slice(sep + 1).trim();
  // Only the faint suffix exists, matched case-insensitively.
  if (suffix !== "" && suffix.toLowerCase() !== "dim") return null;
  // Bare "dim" = default foreground + faint; ":dim" without a colour is junk.
  if (base.toLowerCase() === "dim") return suffix === "" ? "dim" : null;
  let colorHalf: string;
  if (base.startsWith("#")) {
    if (!/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(base)) return null;
    colorHalf = base;
  } else if (base.startsWith("rgb(")) {
    if (!/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(base)) return null;
    colorHalf = base;
  } else {
    const canonical = PALETTE_LOOKUP.get(base.toLowerCase());
    if (!canonical) return null;
    colorHalf = canonical;
  }
  return suffix ? `${colorHalf}:dim` : colorHalf;
}

export interface ResolvedColor {
  /** The colour half of the token; undefined = terminal default foreground. */
  color: string | undefined;
  /** Whether the token asked for the faint attribute. */
  dim: boolean;
}

/** Split a token into the `color`/`dimColor` props Ink understands. */
export function resolveColor(token: ColorToken | undefined): ResolvedColor {
  if (!token) return { color: undefined, dim: false };
  if (token === "dim") return { color: undefined, dim: true };
  const sep = token.indexOf(":");
  if (sep === -1) return { color: token, dim: false };
  return { color: token.slice(0, sep) || undefined, dim: token.slice(sep + 1) === "dim" };
}

/**
 * The bright sibling of a colour half — "cyan" → "cyanBright", hex/rgb pass
 * through untouched. Bright slots are a *different palette entry*, not a
 * bold/faint attribute, so the result stays theme-faithful and composes with
 * dim like any other colour. Unknown names come back unchanged.
 */
export function brightVariant(token: ColorToken): ColorToken {
  const { color, dim } = resolveColor(token);
  if (!color) return token;
  const mapped = PALETTE_LOOKUP.get(color.toLowerCase());
  const bright = mapped ? BRIGHT_SIBLING.get(mapped) : undefined;
  return bright ? (dim ? `${bright}:dim` : bright) : token;
}

/** Palette name → its bright counterpart. */
const BRIGHT_SIBLING = new Map([
  ["black", "blackBright"],
  ["red", "redBright"],
  ["green", "greenBright"],
  ["yellow", "yellowBright"],
  ["blue", "blueBright"],
  ["magenta", "magentaBright"],
  ["cyan", "cyanBright"],
  ["white", "whiteBright"],
  // Slot-8 aliases share blackBright's slot.
  ["gray", "blackBright"],
  ["grey", "blackBright"],
]);

/**
 * Fold a settings-file `theme` block into the live theme. Invalid entries are
 * skipped (with a warning) rather than rejected wholesale, so one bad line
 * doesn't blank out the rest of a user's customisation. Returns the warnings,
 * and also prints them — this runs once at startup, before any UI exists.
 */
export function applyThemeOverrides(
  overrides: Record<string, unknown>,
  warn: (message: string) => void = (m) => console.error(m),
): string[] {
  const warnings: string[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    if (!TOKEN_NAMES.has(key)) {
      warnings.push(`[axle-code] settings: ignoring unknown theme token "${key}"`);
      continue;
    }
    const normalized = typeof value === "string" ? normalizeToken(value) : null;
    if (normalized === null) {
      warnings.push(
        `[axle-code] settings: ignoring invalid theme value for "${key}": ${JSON.stringify(value)} ` +
          `(expected e.g. "cyan", "cyan:dim", "dim", "#38bdf8", "rgb(...)")`,
      );
      continue;
    }
    theme[key as ThemeTokenName] = normalized;
  }
  for (const w of warnings) warn(w);
  return warnings;
}
