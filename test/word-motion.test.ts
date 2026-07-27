// Word-boundary arithmetic. These are pure functions, so they get exhaustive
// table coverage here and the component test stays small.
//
// Notation: "|" marks the cursor in both input and expected output, so a case
// reads as the motion it describes rather than as a pair of integers.
import { describe, expect, it } from "vitest";
import { backwardWord, forwardWord } from "../src/ui/TextInput.js";

function split(marked: string): [string, number] {
  const offset = marked.indexOf("|");
  if (offset === -1) throw new Error(`no cursor marker in ${JSON.stringify(marked)}`);
  return [marked.replace("|", ""), offset];
}

const mark = (value: string, offset: number) => `${value.slice(0, offset)}|${value.slice(offset)}`;

const fwd = (marked: string) => {
  const [value, offset] = split(marked);
  return mark(value, forwardWord(value, offset));
};

const back = (marked: string) => {
  const [value, offset] = split(marked);
  return mark(value, backwardWord(value, offset));
};

describe("forwardWord (macOS-editor: start of the next word)", () => {
  it("from a word start, skips the word and the space after it", () => {
    expect(fwd("|hello brave world")).toBe("hello |brave world");
  });

  it("from mid-word, skips the remainder of that word", () => {
    expect(fwd("hel|lo brave world")).toBe("hello |brave world");
  });

  it("from a space, skips to the next word", () => {
    expect(fwd("hello| brave world")).toBe("hello |brave world");
  });

  it("stops at end of input rather than overshooting", () => {
    expect(fwd("hello |world")).toBe("hello world|");
    expect(fwd("hello world|")).toBe("hello world|");
  });

  it("crosses a run of several separators in one jump", () => {
    expect(fwd("a|  ---  b")).toBe("a  ---  |b");
  });

  it("treats digits and underscores as word characters", () => {
    expect(fwd("|foo_9bar baz")).toBe("foo_9bar |baz");
  });

  it("breaks on punctuation between words", () => {
    expect(fwd("|foo.bar")).toBe("foo.|bar");
  });

  it("handles an empty value", () => {
    expect(fwd("|")).toBe("|");
  });
});

describe("backwardWord (start of the word to the left)", () => {
  it("from end of input, goes to the last word's start", () => {
    expect(back("hello brave world|")).toBe("hello brave |world");
  });

  it("from mid-word, goes to that word's start", () => {
    expect(back("hello bra|ve world")).toBe("hello |brave world");
  });

  it("reads the char LEFT of the cursor, so a leading space skips a whole word", () => {
    // The cursor sits just before "world"; the char to its left is the space,
    // so this lands on "brave", not on "world". This asymmetry with
    // forwardWord is deliberate and was a source of confusion.
    expect(back("hello brave |world")).toBe("hello |brave world");
  });

  it("stops at the start of input rather than undershooting", () => {
    expect(back("hel|lo")).toBe("|hello");
    expect(back("|hello")).toBe("|hello");
  });

  it("crosses a run of several separators in one jump", () => {
    expect(back("a  ---  |b")).toBe("|a  ---  b");
  });

  it("handles an empty value", () => {
    expect(back("|")).toBe("|");
  });
});

describe("round trip", () => {
  it("forward then backward returns to the same word start", () => {
    expect(back(fwd("|hello brave world"))).toBe("|hello brave world");
  });
});
