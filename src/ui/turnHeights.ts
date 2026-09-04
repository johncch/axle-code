import type { Turn, TurnPart } from "@fifthrevision/axle/ui";
import stringWidth from "string-width";
import type { DisplayMode } from "./display.js";

/**
 * Predicted rendered height (in terminal rows) of a Turn — used to seed the
 * virtualization window for turns that have never been on screen.
 *
 * This is deliberately a *prior*, not truth: word-boundary wrapping, markdown
 * transforms, and box borders all make exact math intractable. The MeasuredTurn
 * wrapper overwrites each entry with `measureElement`'s exact value the first
 * time the turn mounts (overscan mounts turns before the user sees them), so
 * predictions only matter far from the cursor where nobody can see the error.
 *
 * The one systematic bias we build in: **overestimate**. Overshooting widens
 * the mounted window (cheap; clipped content costs nothing) while
 * underestimating makes the scroll range too short (user-visible).
 */

/** Blank line above every user turn / part block (`marginTop={1}`). */
const MARGIN = 1;
/** `❯ ` / `● ` prefix rows wrap at columns − 2. */
const INSET = 2;
/** Thinking boxes clamp their body to this many lines (`tailLines(…, 8)`). */
const THINKING_BODY_LINES = 8;
/** Action result boxes clamp theirs too (`MAX_RESULT_LINES` in ActionBlock). */
const RESULT_BODY_LINES = 10;
/** Border rows top+bottom on boxed bodies (thinking, action results). */
const BORDER_ROWS = 2;

function wrappedLines(text: string, width: number): number {
  if (!text) return 0;
  let lines = 0;
  for (const raw of text.split("\n")) {
    // Display width, not .length: CJK/emoji occupy two cells. Round up — a
    // partial trailing cell still occupies a row. Minimum 1: blank lines render.
    lines += Math.max(1, Math.ceil(stringWidth(raw) / Math.max(1, width)));
  }
  return lines;
}

function estimatePart(part: TurnPart, textWidth: number): number {
  switch (part.type) {
    case "text":
      return MARGIN + wrappedLines(part.text, textWidth);
    case "thinking": {
      const text = part.summary || (!part.redacted ? part.text : "");
      // Redacted thinking renders the same header row as normal thinking
      // ("Thinking Redacted"), with no body box — margin + one row.
      if (part.redacted && !text) return MARGIN + 1;
      // Mirrors PartView: summary wins over raw text, and a live part with
      // neither still renders a one-line placeholder box.
      const body = Math.min(wrappedLines(text || "…", textWidth - 4), THINKING_BODY_LINES);
      return MARGIN + 1 + body + BORDER_ROWS;
    }
    case "action": {
      // Label row is always one line (`wrap="truncate-end"`). Sub-agent turns
      // are unpredictable from here — assume a generous fixed block so we
      // overshoot rather than undershoot. Result bodies are clamped to
      // MAX_RESULT_LINES + border, and only present once the tool settles.
      let lines = MARGIN + 1;
      const result = part.detail.result;
      if (result && result.type === "success") {
        const content = typeof result.content === "string" ? result.content : "";
        const shown = Math.min(
          content ? content.split("\n").length : 0,
          RESULT_BODY_LINES,
        );
        lines += shown > 0 ? shown + BORDER_ROWS : 0;
      } else if (result && result.type === "error") {
        // Error results render as a single message line in a bordered box.
        lines += 1 + BORDER_ROWS;
      }
      if (part.kind === "agent") lines += 6;
      return lines;
    }
    case "file":
    case "citation":
    case "compaction":
      return MARGIN + 1;
    default:
      return MARGIN + 1;
  }
}

export function estimateTurnHeight(turn: Turn, columns: number, display: DisplayMode = "verbose"): number {
  // User turns: one margin + prompt rows wrapping at columns − 2.
  if (turn.owner === "user") {
    const typed = turn.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim();
    return MARGIN + Math.max(1, wrappedLines(typed, columns - INSET));
  }
  if (display === "succinct") {
    // Mirrors the succinct renderers: one margin + one label row per part.
    // Agent text can still wrap; thinking headers, action label rows, file /
    // citation / compaction lines are all single rows. Sub-agent children
    // collapse to one `↳ N sub-steps` row per parent. This should be exact,
    // not just a prior — but keep the ≥1 floor like verbose.
    let total = 0;
    for (const part of turn.parts) {
      if (part.type === "text") {
        total += MARGIN + wrappedLines(part.text, columns - INSET);
      } else if (part.type === "action" && part.kind === "agent") {
        const children = part.detail.children;
        total += MARGIN + 1 + (children && children.length > 0 ? MARGIN + 1 : 0);
      } else {
        total += MARGIN + 1;
      }
    }
    const footer =
      turn.status === "error" || turn.status === "cancelled" ? MARGIN + 1 : 0;
    return Math.max(1, total + footer);
  }
  let total = 0;
  for (const part of turn.parts) total += estimatePart(part, columns - INSET);
  const footer =
    turn.status === "error" || turn.status === "cancelled" ? MARGIN + 1 : 0;
  return Math.max(1, total + footer);
}

/**
 * The height table backing transcript virtualization: per-turn rendered
 * heights in rows, keyed by turn id, plus prefix sums for O(log n) window
 * selection. Entries start as predictions and are overwritten by exact
 * measurements as turns mount (see MeasuredTurn); measurements win for the
 * width they were taken at, so a resize silently falls back to predictions
 * until the remounted turns re-measure.
 *
 * Display mode is part of the key for the same reason width is: toggling
 * /display changes every turn's true height, so verbose measurements must
 * never be reused under succinct (and vice versa). Entries measured under a
 * different mode are re-predicted in reindex — the succinct prediction is
 * near-exact, so the first frame after a toggle is already anchored.
 */
export class TurnHeightTable {
  private heights = new Map<string, number>();
  private widths = new Map<string, number>();
  private modes = new Map<string, DisplayMode>();
  private sums: number[] = [];
  private total = 0;

  /** Record a height. Returns true when the stored value changed. */
  set(turnId: string, width: number, height: number, display: DisplayMode = "verbose"): boolean {
    if (
      this.widths.get(turnId) === width &&
      this.modes.get(turnId) === display &&
      this.heights.get(turnId) === height
    ) {
      return false;
    }
    this.widths.set(turnId, width);
    this.modes.set(turnId, display);
    this.heights.set(turnId, height);
    return true;
  }

  get(turnId: string): number | undefined {
    return this.heights.get(turnId);
  }

  /**
   * Rebuild prefix sums from the ordered turn list. Cheap enough to run per
   * commit (n = turn count, not lines). Entries measured at a different width
   * or under a different display mode are re-predicted here, so a resize or a
   * /display toggle needs no separate invalidation step.
   */
  reindex(turns: Turn[], columns: number, display: DisplayMode = "verbose"): void {
    this.sums = new Array(turns.length);
    let acc = 0;
    for (let i = 0; i < turns.length; i++) {
      const id = turns[i].id;
      let h = this.heights.get(id);
      if (h === undefined || this.widths.get(id) !== columns || this.modes.get(id) !== display) {
        h = estimateTurnHeight(turns[i], columns, display);
        this.heights.set(id, h);
        this.widths.set(id, columns);
        this.modes.set(id, display);
      }
      acc += h;
      this.sums[i] = acc;
    }
    this.total = acc;
  }

  /** Total transcript height in rows. */
  get totalHeight(): number {
    return this.total;
  }

  /** Height of turns[0..index] inclusive. */
  endOffset(index: number): number {
    return this.sums[index] ?? 0;
  }

  /** First index whose cumulative height exceeds `offset`. */
  indexOfOffset(offset: number): number {
    // Linear scan; n = turns, not rows, and window selection runs once per
    // commit. Binary search would be premature given typical session sizes,
    // but keep the signature so it can swap in unnoticed.
    for (let i = 0; i < this.sums.length; i++) {
      if (this.sums[i] > offset) return i;
    }
    return Math.max(0, this.sums.length - 1);
  }

  /** Exclusive last index covering turns that start before `offset` rows. */
  endIndexOfOffset(offset: number): number {
    for (let i = 0; i < this.sums.length; i++) {
      if (this.sums[i] >= offset) return i + 1;
    }
    return this.sums.length;
  }
}
