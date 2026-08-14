// Custom text input: an ink-text-input drop-in replacement (cursor handling and
// rendering adapted from vadimdemedes/ink-text-input) that adds word editing.
// Cmd+←/→ (modifier 9 on macOS terminals) or Alt+←/→ jump word boundaries,
// Cmd/Alt+Backspace deletes to the previous boundary, Ctrl+W/K/U delete word /
// to-end / to-start, Ctrl+A/E jump to start/end.
//
// Word motion follows macOS editors, not readline: forward jumps to the START
// of the next word (past the rest of the current word and the whitespace after
// it), rather than stopping at the end of the current word.
//
// Ink marks "word" modifiers as key.meta (Cmd+Left = CSI 1;9D → meta) or
// key.ctrl (Ctrl+Left = CSI 1;5D → ctrl) on arrow/backspace keypresses. Plain
// char editing is unchanged from the stock component.
//
// Terminal.app and iTerm send Option+←/→ as ESC b / ESC f (readline meta-b /
// meta-f), NOT as a CSI arrow, so those are handled separately. Ink surfaces
// them as input "b"/"f" with key.meta, which is what tells them apart from
// someone typing a literal b or f. Caveat: that only holds when both bytes
// land in one read — if the ESC arrives in its own chunk, Ink emits a bare
// escape and then a plain "b", which inserts. We deliberately don't track
// pending-escape state to paper over it: it would turn "press Esc, then type
// b" into a word jump, which is worse than the rare split-read miss.
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
      // xterm's "modifyOtherKeys" reports Shift+Enter (and other modified
      // Enters) as CSI 27 ; <modifier> ; 13 ~. Ink doesn't parse that form, so
      // it reaches us as the literal string "[27;2;13~" (the leading ESC is
      // stripped in useInput). Decode it so Shift+Enter inserts a newline
      // rather than that garbage being typed into the prompt.
      const modifiedEnter = /^\[27;\d+;13~$/.exec(input);

      if (
        key.upArrow ||
        key.downArrow ||
        (key.ctrl && input === "c") ||
        key.tab ||
        (key.shift && key.tab)
      ) {
        return;
      }

      // Plain Enter submits. Shift/meta+Enter — and the modifyOtherKeys Enter
      // sequences above — insert a newline instead.
      if (key.return && !key.shift && !key.meta && !modifiedEnter) {
        onSubmit?.(value);
        return;
      }

      const wordMod = key.meta || key.ctrl;
      setState((prev) => {
        const current = prev.value;
        let offset = prev.cursorOffset;
        let next = current;

        if (key.return || modifiedEnter) {
          // Shift/meta+Enter: insert a newline at the cursor.
          next = current.slice(0, offset) + "\n" + current.slice(offset);
          offset += 1;
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
