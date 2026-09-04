/** Transcript display mode: a purely presentational toggle.
 *
 * - `verbose` — status quo: every part renders in full (thinking boxes,
 *   tool result boxes, sub-agent children).
 * - `succinct` — activity log: one row per part, all boxed detail collapsed.
 *
 * This never touches the underlying turns/transcript — it only changes how
 * TurnView/ActionBlock render and how the height table predicts. Session
 * files don't persist it; it's an in-memory experiment toggle.
 */
export type DisplayMode = "verbose" | "succinct";

export const DISPLAY_MODES: DisplayMode[] = ["verbose", "succinct"];

export function parseDisplayMode(raw: string): DisplayMode | null {
  const q = raw.trim().toLowerCase();
  if (q === "verbose") return "verbose";
  if (q === "succinct") return "succinct";
  return null;
}
