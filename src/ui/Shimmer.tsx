import { Text } from "ink";
import chalk from "chalk";
import React, { useEffect, useMemo, useState } from "react";
import { brightVariant, resolveColor, theme } from "./theme.js";

/** Frames per second — ~10fps reads as smooth in a terminal and keeps CPU idle. */
const FPS = 10;
/** Width of the bright band that sweeps across the text, in characters. */
const BAND_WIDTH = 6;

/** Palette/hex colour half → chalk painter. Names are pre-validated against
 * the canonical chalk set in theme.ts; anything else falls back to plain. */
function paint(s: string, color: string | undefined): string {
  if (!color) return s;
  if (color.startsWith("#")) return chalk.hex(color)(s);
  if (color.startsWith("rgb(")) {
    const [r, g, b] = color
      .slice(4, -1)
      .split(",")
      .map((p) => Number.parseInt(p.trim(), 10));
    if ([r, g, b].every((n) => Number.isFinite(n))) return chalk.rgb(r!, g!, b!)(s);
    return s;
  }
  const painter = (chalk as unknown as Record<string, ((s: string) => string) | undefined>)[
    color
  ];
  return typeof painter === "function" ? painter(s) : s;
}

/**
 * Colour half for one character, from its position in the band. Outside the
 * band (intensity 0) text rests on the `settled` token (white by default —
 * retunable via settings), the shoulders are the `accent` palette slot, and
 * the core is accent's *bright sibling* slot. All real palette entries, so
 * every character renders through the same colour scheme as the rest of the
 * UI.
 *
 * The faint attribute is deliberately NOT applied here — see the `<Text>`
 * below, which carries `dimColor` for the whole element in one SGR.
 */
function colorHalfFor(intensity: number): string | undefined {
  if (intensity <= 0) return resolveColor(theme.settled).color;
  const token = intensity < 0.5 ? theme.accent : brightVariant(theme.accent);
  return resolveColor(token).color;
}

/**
 * A sweeping highlight that cycles across `text` while `active`, then freezes
 * into the resting colour when idle.
 *
 * Look: the entire element is faint (`dimColor`) — white-dim at rest, with a
 * dimmed accent band whose core tips into accent's bright sibling. One styled
 * string per frame (not one <Text> per character): Ink only rewrites the lines
 * that changed between frames, so a single animated line costs one cheap line
 * repaint per tick. When colour is unavailable (pipe, CI, NO_COLOR —
 * chalk.level === 0) the styling is skipped and this degrades to static text,
 * so output stays clean when redirected.
 */
export function Shimmer({ text, active }: { text: string; active: boolean }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000 / FPS);
    return () => clearInterval(id);
  }, [active]);

  const styled = useMemo(() => {
    if (chalk.level === 0) return text;
    // The wavefront wraps around so the band re-enters from the left instead
    // of jumping; the cycle spans the text plus a gap so the sweep reads as
    // distinct passes rather than a constant glow. While idle the band sits
    // out entirely — every character takes the resting colour.
    const cycle = text.length + BAND_WIDTH * 2;
    const head = active ? (tick * 2) % cycle : Number.NaN;
    return [...text]
      .map((ch, i) => {
        if (Number.isNaN(head)) return paint(ch, colorHalfFor(0));
        const distance = Math.min(Math.abs(i - head), Math.abs(i - head - cycle));
        const intensity = Math.max(0, 1 - distance / BAND_WIDTH);
        // Cosine falloff softens which sweep level each character lands in.
        const eased = intensity === 0 ? 0 : (1 - Math.cos(intensity * Math.PI)) / 2;
        return paint(ch, colorHalfFor(eased));
      })
      .join("");
  }, [text, active, tick]);

  // dimColor paints the faint attribute over the whole element once, so every
  // character — rest, shoulder, and core — reads as one muted shimmer.
  return <Text dimColor>{styled}</Text>;
}
