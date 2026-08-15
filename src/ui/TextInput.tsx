// Custom text input: an ink-text-input drop-in replacement (cursor handling and
// rendering adapted from vadimdemedes/ink-text-input) that adds word editing.
// Cmd+←/→ (modifier 9 on macOS terminals) or Alt+←/→ jump word boundaries,
// Cmd/Alt+Backspace deletes to the previous boundary, Ctrl+W/K/U delete word /
// to-end / to-start, Ctrl+A/E jump to start/end, ↑/↓ move between lines of a
// multi-line draft (a no-op when there is only one line).
//
// Word motion follows macOS editors, not readline: forward jumps to the START
// of the next word (past the rest of the current word and the whitespace after
// it), rather than stopping at the end of the current word.
//
// Ink marks "word" modifiers as key.meta (Cmd+Left = CSI 1;9D → meta) or
// key.ctrl (Ctrl+Left = CSI 1;5D → ctrl) on arrow/backspace keypresses. Plain
// char editing is unchanged from the stock component.
//
// src/index.tsx enables the kitty keyboard protocol, so on terminals that
// support it every binding below arrives as a parsed key event — including
// Shift+Enter, which legacy terminals can only report as a raw CSI 27;2;13~.
// The legacy paths stay because the protocol is negotiated, not guaranteed.
//
// Terminal.app and iTerm send Option+←/→ as ESC b / ESC f (readline meta-b /
// meta-f), NOT as a CSI arrow, so those are handled separately. Ink surfaces
// them as input "b"/"f" with key.meta, which is what tells them apart from
// someone typing a literal b or f. Caveat: that only holds when both bytes
// land in one read — if the ESC arrives in its own chunk, Ink emits a bare
// escape and then a plain "b", which inserts. We deliberately don't track
// pending-escape state to paper over it: it would turn "press Esc, then type
// b" into a word jump, which is worse than the rare split-read miss. The
// kitty protocol removes the hazard outright by encoding Option+b as CSI 98;3u.
//
// {value, cursorOffset} is the authoritative edit model: terminal input can
// deliver several keypresses within one React batch, so every update computes
// from the previous state — closure-captured props would collapse consecutive
// word jumps. Both directions of the parent handshake therefore run in effects
// keyed on the settled value, NOT inline after setState: React defers the
// updater, so the new value does not exist yet on the following statement.
import { Text, useInput } from "ink";
import React, { useEffect, useRef, useState } from "react";

const ansi = (code: string, s: string) => `\x1b[${code}m${s}\x1b[0m`;
const inverse = (s: string) => ansi("7", s);
const grey = (s: string) => ansi("90", s);

export type TextInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  showCursor?: boolean;
};

const isWordChar = (ch: string) => /[\p{L}\p{N}_]/u.test(ch);

/** Start of the next word to the right of `offset` (macOS-editor forward-word). */
export function forwardWord(value: string, offset: number): number {
  let i = offset;
  const n = value.length;
  while (i < n && isWordChar(value[i]!)) i++;
  while (i < n && !isWordChar(value[i]!)) i++;
  return i;
}

/** Start of the word to the left of `offset` (readline backward-word). */
export function backwardWord(value: string, offset: number): number {
  let i = offset;
  while (i > 0 && !isWordChar(value[i - 1]!)) i--;
  while (i > 0 && isWordChar(value[i - 1]!)) i--;
  return i;
}

/** Offset of the first character of the line containing `offset`. */
export function lineStart(value: string, offset: number): number {
  const previousBreak = value.lastIndexOf("\n", offset - 1);
  return previousBreak === -1 ? 0 : previousBreak + 1;
}

/** Offset of the line break ending the line containing `offset`, else the end. */
export function lineEnd(value: string, offset: number): number {
  const nextBreak = value.indexOf("\n", offset);
  return nextBreak === -1 ? value.length : nextBreak;
}

/**
 * Same column one line up, clamped to that line's length; a no-op on the first
 * line. The column is recomputed from the cursor every time rather than
 * remembered across moves, so up-then-down through a short line lands at that
 * line's end, not the original column.
 */
export function lineUp(value: string, offset: number): number {
  const start = lineStart(value, offset);
  if (start === 0) return offset;
  const column = offset - start;
  return Math.min(lineStart(value, start - 1) + column, start - 1);
}

/** Same column one line down, clamped to that line's length; no-op on the last. */
export function lineDown(value: string, offset: number): number {
  const end = lineEnd(value, offset);
  if (end === value.length) return offset;
  const column = offset - lineStart(value, offset);
  const nextStart = end + 1;
  return Math.min(nextStart + column, lineEnd(value, nextStart));
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));

export function TextInput({
  value: originalValue,
  onChange,
  onSubmit,
  placeholder = "",
  focus = true,
  showCursor = true,
}: TextInputProps) {
  const [state, setState] = useState(() => ({
    cursorOffset: (originalValue || "").length,
    value: originalValue || "",
  }));
  // The last value that crossed the boundary in either direction. It is what
  // tells the echo of our own onChange apart from a genuine external set.
  const settled = useRef(state.value);

  // Push local edits up. This has to be an effect rather than a call right
  // after setState: React defers the updater, so the new value does not exist
  // yet on the next statement — reading it there emits nothing at all.
  useEffect(() => {
    if (state.value === settled.current) return;
    settled.current = state.value;
    onChange(state.value);
  }, [state.value, onChange]);

  // Adopt a parent-owned value (e.g. Ctrl+C clearing the input). Our own echo
  // arrives here too and is ignored, so it cannot clobber the cursor.
  useEffect(() => {
    const prop = originalValue || "";
    if (prop === settled.current) return;
    settled.current = prop;
    setState({ value: prop, cursorOffset: prop.length });
  }, [originalValue]);

  const { value, cursorOffset } = state;

  let renderedValue = value;
  let renderedPlaceholder = placeholder ? grey(placeholder) : undefined;

  // Fake cursor: invert the character under the cursor (or a trailing space).
  if (showCursor && focus) {
    renderedPlaceholder =
      placeholder.length > 0 ? inverse(placeholder[0]!) + grey(placeholder.slice(1)) : inverse(" ");
    renderedValue = value.length > 0 ? "" : inverse(" ");
    let i = 0;
    for (const char of value) {
      renderedValue += i === cursorOffset ? inverse(char) : char;
      i++;
    }
    if (value.length > 0 && cursorOffset === value.length) {
      renderedValue += inverse(" ");
    }
  }

  useInput(
    (input, key) => {
      if ((key.ctrl && input === "c") || key.tab || (key.shift && key.tab)) {
        return;
      }

      // Ink forwards escape sequences it has no mapping for as their literal
      // text with the ESC stripped, which would otherwise be typed into the
      // prompt. Two of those need decoding rather than dropping: xterm's
      // modifyOtherKeys reports Shift/Ctrl+Enter as CSI 27;<mod>;13~, which is
      // the only way a terminal without the kitty protocol can express them.
      // The character class covers CSI private/intermediate parameter bytes
      // (`?`, `<`, `>`, `=`), so terminal *reports* are dropped too — a kitty
      // "[?0u" or a cursor-position "[24;80R" must never reach the prompt.
      const legacyModifiedEnter = /^\[27;\d+;13~$/.test(input);
      if (!legacyModifiedEnter && /^\[[?<>=]?[\d;:]*[~A-Za-z]$/.test(input)) return;

      // Plain Enter submits; Shift/Option+Enter insert a newline.
      if (key.return && !key.shift && !key.meta && !legacyModifiedEnter) {
        onSubmit?.(value);
        return;
      }

      const wordMod = key.meta || key.ctrl;
      setState((prev) => {
        const current = prev.value;
        let offset = prev.cursorOffset;
        let next = current;

        if (key.return || legacyModifiedEnter) {
          next = current.slice(0, offset) + "\n" + current.slice(offset);
          offset += 1;
        } else if (key.upArrow) {
          if (!showCursor) return prev;
          offset = lineUp(current, offset);
        } else if (key.downArrow) {
          if (!showCursor) return prev;
          offset = lineDown(current, offset);
        } else if (key.leftArrow) {
          if (!showCursor) return prev;
          offset = wordMod ? backwardWord(current, offset) : offset - 1;
        } else if (key.rightArrow) {
          if (!showCursor) return prev;
          offset = wordMod ? forwardWord(current, offset) : offset + 1;
        } else if (key.meta && input === "b") {
          if (!showCursor) return prev;
          offset = backwardWord(current, offset);
        } else if (key.meta && input === "f") {
          if (!showCursor) return prev;
          offset = forwardWord(current, offset);
        } else if (key.home || (key.ctrl && input === "a")) {
          offset = 0;
        } else if (key.end || (key.ctrl && input === "e")) {
          offset = current.length;
        } else if (key.backspace || key.delete || (key.ctrl && input === "w")) {
          if (offset > 0) {
            // Cmd/Alt+Backspace and Ctrl+W delete back to the previous word
            // boundary; both set wordMod. Plain backspace deletes one char.
            const cut = wordMod ? backwardWord(current, offset) : offset - 1;
            next = current.slice(0, cut) + current.slice(offset);
            offset = cut;
          }
        } else if (key.ctrl && input === "k") {
          next = current.slice(0, offset);
        } else if (key.ctrl && input === "u") {
          next = current.slice(offset);
          offset = 0;
        } else {
          next = current.slice(0, offset) + input + current.slice(offset);
          offset += input.length;
        }

        const cursorOffset = clamp(offset, 0, next.length);
        return { value: next, cursorOffset };
      });
    },
    { isActive: focus },
  );

  return (
    <Text>
      {placeholder ? (value.length > 0 ? renderedValue : renderedPlaceholder) : renderedValue}
    </Text>
  );
}

export default TextInput;
