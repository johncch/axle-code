// Integration tests that need a real render: key routing, and the batching
// behaviour that motivated this component in the first place. Word-boundary
// arithmetic is covered exhaustively in word-motion.test.ts.
//
// IMPORTANT: this drives ink-testing-library's simulated stdin, so it proves
// the component reacts correctly to a given key ENCODING. It cannot prove your
// terminal emits that encoding. Option+Left is CSI 1;3D in some emulators and
// ESC b in Terminal.app; both are exercised below for that reason, and a green
// run here is not evidence that a keybinding works in a real terminal.
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import React, { useState } from "react";
import { TextInput } from "../src/ui/TextInput.js";

const KEY = {
  cmdLeft: "\x1b[1;9D",
  cmdRight: "\x1b[1;9C",
  altLeft: "\x1b[1;3D",
  ctrlLeft: "\x1b[1;5D",
  ctrlRight: "\x1b[1;5C",
  left: "\x1b[D",
  escB: "\x1bb",
  escF: "\x1bf",
  altBackspace: "\x1b\x7f",
  backspace: "\x7f",
  ctrlW: "\x17",
  ctrlA: "\x01",
  ctrlE: "\x05",
  ctrlU: "\x15",
  ctrlK: "\x0b",
  up: "\x1b[A",
  down: "\x1b[B",
  enter: "\r",
  // Kitty keyboard protocol (enabled in src/index.tsx): Enter is codepoint 13,
  // modifier 2 = shift.
  kittyEnter: "\x1b[13u",
  kittyShiftEnter: "\x1b[13;2u",
  // What a legacy terminal sends for Shift+Enter when it has modifyOtherKeys
  // on: Ink has no mapping for it, so it arrives as literal text.
  legacyShiftEnter: "\x1b[27;2;13~",
} as const;

const tick = () => new Promise((r) => setTimeout(r, 20));

function Harness({
  onValue,
  onSubmit,
}: {
  onValue?: (v: string) => void;
  onSubmit?: (v: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <TextInput
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
      onSubmit={onSubmit}
    />
  );
}

/**
 * Renders the component and returns a driver. `text()` strips ANSI and spaces,
 * so assertions read as a word sequence — word-delete intentionally leaves the
 * whitespace around the word it removed.
 */
async function editor() {
  const submissions: string[] = [];
  const { stdin, lastFrame, unmount } = render(
    <Harness onSubmit={(v) => submissions.push(v)} />,
  );
  await tick();
  return {
    unmount,
    submissions,
    async type(...keys: string[]) {
      for (const k of keys) {
        stdin.write(k);
        await tick();
      }
    },
    text: () => (lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "").replace(/ /g, ""),
  };
}

describe("TextInput key handling", () => {
  it("inserts typed characters", async () => {
    const ed = await editor();
    await ed.type("hello brave new world");
    expect(ed.text()).toBe("hellobravenewworld");
    ed.unmount();
  });

  // The regression this component exists for: several keypresses can land in
  // one React batch, so each update must derive from the previous state. With
  // closure-captured props these three jumps collapse into one.
  it("applies consecutive word jumps without collapsing them", async () => {
    const ed = await editor();
    await ed.type("hello brave new world");
    await ed.type(KEY.cmdLeft, KEY.cmdLeft, KEY.cmdLeft, "X");
    expect(ed.text()).toBe("helloXbravenewworld");
    ed.unmount();
  });

  it("collapses nothing even when the jumps arrive in a single write", async () => {
    const ed = await editor();
    await ed.type("hello brave new world");
    await ed.type(KEY.cmdLeft + KEY.cmdLeft + KEY.cmdLeft);
    await ed.type("X");
    expect(ed.text()).toBe("helloXbravenewworld");
    ed.unmount();
  });

  it.each([
    ["plain Enter (\\r)", KEY.enter],
    ["kitty Enter (CSI 13u)", KEY.kittyEnter],
  ])("submits on %s", async (_label, key) => {
    const ed = await editor();
    await ed.type("send this", key);
    expect(ed.submissions).toEqual(["send this"]);
    expect(ed.text()).toBe("sendthis");
    ed.unmount();
  });

  // Both encodings must work: the kitty protocol is negotiated at startup, and
  // a terminal that declines it can only report Shift+Enter as CSI 27;2;13~.
  it.each([
    ["kitty (CSI 13;2u)", KEY.kittyShiftEnter],
    ["legacy modifyOtherKeys (CSI 27;2;13~)", KEY.legacyShiftEnter],
  ])("inserts a newline on Shift+Enter via %s", async (_label, key) => {
    const ed = await editor();
    await ed.type("first", key, "second");
    expect(ed.submissions).toEqual([]);
    expect(ed.text()).toContain("\n");
    ed.unmount();
  });

  it("moves the cursor between lines with up/down once the draft is multi-line", async () => {
    const ed = await editor();
    await ed.type("first", KEY.kittyShiftEnter, "second");
    await ed.type(KEY.up, "X");
    expect(ed.text()).toBe("firstX\nsecond");
    await ed.type(KEY.down, "Y");
    expect(ed.text()).toBe("firstX\nsecondY");
    ed.unmount();
  });

  // Nothing to move to on a single line, so the cursor stays put rather than
  // jumping to the start or end.
  it("leaves the cursor alone on up/down in a single-line draft", async () => {
    const ed = await editor();
    await ed.type("hello", KEY.up, KEY.down, "X");
    expect(ed.text()).toBe("helloX");
    ed.unmount();
  });

  // Anything else Ink can't map arrives as literal text. Typing that into the
  // prompt is worse than ignoring the key, so it must not appear in the value.
  // Includes terminal *reports*, not just keys: a kitty query response or a
  // cursor-position report can arrive on stdin at any time, and Ink passes
  // anything it can't map through as literal text.
  it.each([
    ["kitty query response", "\x1b[?0u"],
    ["cursor position report", "\x1b[24;80R"],
    ["unmapped CSI", "\x1b[200;3~"],
  ])("never types %s into the prompt", async (_label, sequence) => {
    const ed = await editor();
    await ed.type("hello", sequence);
    expect(ed.text()).toBe("hello");
    expect(ed.submissions).toEqual([]);
    ed.unmount();
  });

  it.each([
    ["Cmd+arrow (CSI 1;9)", KEY.cmdLeft],
    ["Alt+arrow (CSI 1;3)", KEY.altLeft],
    ["Ctrl+arrow (CSI 1;5)", KEY.ctrlLeft],
    ["ESC b (Terminal.app Option+Left)", KEY.escB],
  ])("jumps a word back on %s", async (_label, key) => {
    const ed = await editor();
    await ed.type("hello world", key, "X");
    expect(ed.text()).toBe("helloXworld");
    ed.unmount();
  });

  it.each([
    ["Cmd+arrow (CSI 1;9)", KEY.cmdRight],
    ["Ctrl+arrow (CSI 1;5)", KEY.ctrlRight],
    ["ESC f (Terminal.app Option+Right)", KEY.escF],
  ])("jumps a word forward on %s", async (_label, key) => {
    const ed = await editor();
    await ed.type("hello world", KEY.ctrlA, key, "X");
    expect(ed.text()).toBe("helloXworld");
    ed.unmount();
  });

  // ESC b / ESC f are only distinguishable from typed letters by key.meta.
  it("still inserts a literal b or f typed without meta", async () => {
    const ed = await editor();
    await ed.type("bf");
    expect(ed.text()).toBe("bf");
    ed.unmount();
  });

  it.each([
    ["Alt+Backspace", KEY.altBackspace],
    ["Ctrl+W", KEY.ctrlW],
  ])("deletes the previous word on %s", async (_label, key) => {
    const ed = await editor();
    await ed.type("hello brave world", key);
    expect(ed.text()).toBe("hellobrave");
    ed.unmount();
  });

  it("deletes a single character on plain backspace", async () => {
    const ed = await editor();
    await ed.type("hello", KEY.backspace);
    expect(ed.text()).toBe("hell");
    ed.unmount();
  });

  it("moves to start on Ctrl+A and to end on Ctrl+E", async () => {
    const ed = await editor();
    await ed.type("hello", KEY.ctrlA, "S");
    expect(ed.text()).toBe("Shello");
    await ed.type(KEY.ctrlE, "E");
    expect(ed.text()).toBe("ShelloE");
    ed.unmount();
  });

  it("deletes to start on Ctrl+U and to end on Ctrl+K", async () => {
    const ed = await editor();
    await ed.type("hello world", KEY.cmdLeft, KEY.ctrlU);
    expect(ed.text()).toBe("world");
    ed.unmount();

    const ed2 = await editor();
    await ed2.type("hello world", KEY.cmdLeft, KEY.ctrlK);
    expect(ed2.text()).toBe("hello");
    ed2.unmount();
  });

  it("edits at the cursor after a plain arrow move", async () => {
    const ed = await editor();
    await ed.type("abc", KEY.left, "-");
    expect(ed.text()).toBe("ab-c");
    ed.unmount();
  });
});

describe("TextInput parent sync", () => {
  it("reports each edit to the parent", async () => {
    const seen: string[] = [];
    const { stdin, unmount } = render(<Harness onValue={(v) => seen.push(v)} />);
    await tick();
    stdin.write("hi");
    await tick();
    expect(seen).toEqual(["hi"]);
    unmount();
  });

  // The parent owns the value, so an external set (e.g. Ctrl+C clearing the
  // input) must win over the component's local edit state.
  it("takes the parent's value when the parent sets it externally", async () => {
    function Controlled() {
      const [value, setValue] = useState("typed text");
      return (
        <>
          <TextInput value={value} onChange={setValue} />
          <ClearAfterMount onClear={() => setValue("")} />
        </>
      );
    }
    function ClearAfterMount({ onClear }: { onClear: () => void }) {
      React.useEffect(() => {
        const t = setTimeout(onClear, 10);
        return () => clearTimeout(t);
      }, [onClear]);
      return null;
    }

    const { lastFrame, unmount } = render(<Controlled />);
    await tick();
    await tick();
    expect((lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "").trim()).toBe("");
    unmount();
  });
});
