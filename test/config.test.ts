// The unified config loader: one `code.yaml` per layer, YAML-superset
// parsing, legacy-fallback behavior, and the write path.
//
// Layers: `~/.axle/code.yaml` (global) merged with `.axle/code.yaml`
// (project-local, wins per top-level key; theme/compaction deep-merge).
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, writeConfig, type AxleConfig } from "../src/config.js";

let home: string;
let project: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "axle-cfg-home-"));
  project = await mkdtemp(join(tmpdir(), "axle-cfg-proj-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
});

/** Write a file into the given layer directory, creating it if needed. */
async function put(dir: string, name: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), content, "utf-8");
}

const load = () => loadConfig({ globalDir: home, projectDir: project });

describe("loadConfig", () => {
  it("returns an empty config when nothing exists anywhere", async () => {
    expect(load()).toEqual({});
  });

  it("reads a global code.yaml", async () => {
    await put(home, "code.yaml", "defaultModel: anthropic/claude-sonnet-5\ncompaction:\n  threshold: 123000\n");
    expect(load()).toEqual({
      defaultModel: "anthropic/claude-sonnet-5",
      compaction: { threshold: 123_000 },
    });
  });

  it("parses JSON content too — YAML is a superset", async () => {
    await put(home, "code.yaml", '{ "defaultModel": "z-ai/glm-5.2" }\n');
    expect(load().defaultModel).toBe("z-ai/glm-5.2");
  });

  it("lets the project layer win per top-level key", async () => {
    await put(home, "code.yaml", "defaultModel: anthropic/claude-sonnet-5\ntheme:\n  accent: green\n");
    await put(project, "code.yaml", "defaultModel: z-ai/glm-5.2\n");
    expect(load().defaultModel).toBe("z-ai/glm-5.2");
    expect(load().theme).toEqual({ accent: "green" }); // untouched by the local layer
  });

  it("deep-merges theme and compaction across layers", async () => {
    await put(
      home,
      "code.yaml",
      "theme:\n  accent: green\n  faint: gray:dim\ncompaction:\n  threshold: 100000\n  target: 30000\n",
    );
    await put(project, "code.yaml", "theme:\n  accent: magenta\ncompaction:\n  threshold: 90000\n");
    expect(load()).toEqual({
      theme: { accent: "magenta", faint: "gray:dim" },
      compaction: { threshold: 90_000 },
    });
  });

  it("ignores the removed compaction.target key", async () => {
    await put(home, "code.yaml", "compaction:\n  threshold: 100000\n  target: 30000\n");
    expect(load()).toEqual({ compaction: { threshold: 100_000 } });
    await put(project, "code.yaml", "compaction:\n  target: 5000\n");
    expect(load()).toEqual({ compaction: { threshold: 100_000 } }); // nothing added
  });

  it("treats a compaction block with only the removed key as empty", async () => {
    await put(home, "code.yaml", "compaction:\n  target: 30000\n");
    expect(load()).toEqual({});
  });

  it("treats an empty file as absent, not an error", async () => {
    await put(home, "code.yaml", "\n");
    expect(load()).toEqual({});
  });

  it("keeps loading the other layer when one file is broken", async () => {
    await put(home, "code.yaml", "defaultModel: anthropic/claude-sonnet-5\n");
    await put(project, "code.yaml", "{{{ not yaml\n");
    expect(load().defaultModel).toBe("anthropic/claude-sonnet-5");
  });

  it("drops wrong-typed keys instead of rejecting the whole file", async () => {
    await put(
      home,
      "code.yaml",
      'defaultModel: 42\nmodels: ["ok/one"]\ntheme: nope\ncompaction:\n  threshold: lots\n',
    );
    expect(load()).toEqual({ models: ["ok/one"] });
  });
});

describe("legacy fallback (the old code.json / settings.json / models.json trio)", () => {
  it("is honored per layer when that layer has no code.yaml", async () => {
    await put(home, "code.json", '{ "defaultModel": "anthropic/claude-sonnet-5" }');
    await put(home, "settings.json", '{ "theme": { "accent": "green" } }');
    await put(home, "models.json", '["anthropic/claude-sonnet-5", "z-ai/glm-5.2"]');
    expect(load()).toEqual({
      defaultModel: "anthropic/claude-sonnet-5",
      theme: { accent: "green" },
      models: ["anthropic/claude-sonnet-5", "z-ai/glm-5.2"],
    });
  });

  it("layers the legacy files like the new ones — local wins", async () => {
    await put(home, "code.json", '{ "defaultModel": "anthropic/claude-sonnet-5" }');
    await put(project, "code.json", '{ "defaultModel": "z-ai/glm-5.2" }');
    expect(load().defaultModel).toBe("z-ai/glm-5.2");
  });

  it("mixes formats across layers", async () => {
    await put(home, "code.json", '{ "defaultModel": "anthropic/claude-sonnet-5", "models": ["a/one"] }');
    await put(project, "code.yaml", "theme:\n  accent: magenta\n");
    expect(load()).toEqual({
      defaultModel: "anthropic/claude-sonnet-5",
      models: ["a/one"],
      theme: { accent: "magenta" },
    });
  });

  it("code.yaml wins over the legacy trio in the same layer", async () => {
    await put(home, "code.yaml", "defaultModel: from-yaml\n");
    await put(home, "code.json", '{ "defaultModel": "from-json" }');
    expect(load().defaultModel).toBe("from-yaml");
  });

  it("accepts the models list in JSON or YAML flow style", async () => {
    await put(home, "models.json", '["a/one", "b/two"]');
    expect(load().models).toEqual(["a/one", "b/two"]);
    await rm(join(home, "models.json"));
    await put(home, "models.json", "- a/one\n- b/two\n");
    expect(load().models).toEqual(["a/one", "b/two"]);
  });

  it("rejects bad legacy models files rather than guessing", async () => {
    await put(home, "models.json", '{ "not": "an array" }');
    expect(load().models).toBeUndefined();
  });
});

describe("writeConfig", () => {
  it("round-trips a patch through loadConfig", async () => {
    const patch: Partial<AxleConfig> = { defaultModel: "openai/gpt-5.4" };
    await writeConfig(patch, home);
    expect(loadConfig({ globalDir: home, projectDir: project })).toEqual(patch);
  });

  it("seeds a legacy-only directory into code.yaml on first write", async () => {
    await put(home, "code.json", '{ "defaultModel": "anthropic/claude-sonnet-5" }');
    await put(home, "models.json", '["a/one"]');
    await writeConfig({ defaultModel: "openai/gpt-5.4" }, home);

    const written = await readFile(join(home, "code.yaml"), "utf-8");
    expect(written).toContain("defaultModel: openai/gpt-5.4");
    expect(written).toContain("- a/one"); // migrated, not dropped

    // The legacy files still exist but no longer drive the global layer.
    expect(loadConfig({ globalDir: home, projectDir: project })).toEqual({
      defaultModel: "openai/gpt-5.4",
      models: ["a/one"],
    });
  });

  it("preserves keys outside the patch", async () => {
    await writeConfig({ defaultModel: "a/one", theme: { accent: "green" } }, home);
    await writeConfig({ defaultModel: "b/two" }, home);
    expect(loadConfig({ globalDir: home, projectDir: project })).toEqual({
      defaultModel: "b/two",
      theme: { accent: "green" },
    });
  });
});
