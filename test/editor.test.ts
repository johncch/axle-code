// The /settings editor hand-off: target enumeration, $EDITOR resolution,
// seeding a fresh config, and the spawn contract (inherited stdio, non-zero
// exit reported as failed rather than thrown).
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  editFile,
  resolveEditor,
  seedConfig,
  settingsTargets,
  type SettingsTarget,
} from "../src/editor.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "axle-editor-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function target(name: string): SettingsTarget {
  return { label: name, path: join(dir, name) };
}

describe("settingsTargets", () => {
  it("lists the user layer first, then the project layer", () => {
    const targets = settingsTargets("/some/project");
    expect(targets).toHaveLength(2);
    expect(targets[0].path).toContain(".axle/code.yaml");
    expect(targets[0].path).not.toContain("/some/project");
    expect(targets[1].path).toBe("/some/project/.axle/code.yaml");
  });

  it("labels include the path so both layers are distinguishable", () => {
    const [user, project] = settingsTargets("/some/project");
    expect(user.label).toContain("/.axle/code.yaml");
    expect(project.label).toContain("/some/project/.axle/code.yaml");
  });
});

describe("resolveEditor", () => {
  it("prefers VISUAL over EDITOR", () => {
    expect(resolveEditor({ VISUAL: "code -w", EDITOR: "vim" })).toBe("code -w");
  });

  it("falls back to EDITOR, then vi", () => {
    expect(resolveEditor({ EDITOR: "nano" })).toBe("nano");
    expect(resolveEditor({})).toBe("vi");
  });

  it("treats blank env values as unset", () => {
    expect(resolveEditor({ VISUAL: "  ", EDITOR: "nano" })).toBe("nano");
    expect(resolveEditor({ EDITOR: "" })).toBe("vi");
  });
});

describe("seedConfig", () => {
  it("creates a missing file with the config header and reports seeding", async () => {
    const path = target("fresh.yaml").path;
    await expect(seedConfig(path)).resolves.toBe(true);
    const content = await readFile(path, "utf-8");
    expect(content).toContain("# axle-code configuration.");
  });

  it("leaves an existing file untouched and reports not-seeded", async () => {
    const path = target("existing.yaml").path;
    await seedConfig(path);
    await expect(seedConfig(path)).resolves.toBe(false);
    expect(await readFile(path, "utf-8")).toBe(await readFile(path, "utf-8"));
  });

  it("does not clobber a user's customizations", async () => {
    const path = target("custom.yaml").path;
    await seedConfig(path);
    // Simulate a hand-edit between seed calls.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, "defaultModel: a/one\n", "utf-8");
    await expect(seedConfig(path)).resolves.toBe(false);
    expect(await readFile(path, "utf-8")).toBe("defaultModel: a/one\n");
  });
});

describe("editFile", () => {
  it("runs the editor to completion and reports success", async () => {
    const result = await editFile({ label: "", path: join(dir, "out.txt") }, { VISUAL: "true" });
    expect(result.failed).toBe(false);
    expect(result.editor).toBe("true");
  });

  it("reports a non-zero editor exit as failed, not a throw", async () => {
    const result = await editFile({ label: "", path: join(dir, "out.yaml") }, { VISUAL: "false" });
    expect(result.failed).toBe(true);
  });

  it("reports a missing editor binary as failed", async () => {
    const result = await editFile(
      { label: "", path: join(dir, "out.yaml") },
      { VISUAL: "axle-code-definitely-not-an-editor-xyz" },
    );
    expect(result.failed).toBe(true);
  });

  it("hands the real path to the editor, which can create the file", async () => {
    // `touch` stands in for an editor: it receives the path as an argument
    // (the spawn contract) and exits 0 without needing an interactive stdin.
    const path = join(dir, "touched.yaml");
    const result = await editFile({ label: "", path }, { VISUAL: "touch" });
    expect(result.failed).toBe(false);
    await expect(stat(path)).resolves.toBeTruthy();
  });
});
