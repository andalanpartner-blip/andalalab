import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";

/**
 * The rule that guards the architecture is itself under test.
 *
 * A lint rule nobody has seen fail is indistinguishable from a lint rule that
 * does not work. These probes are never written to disk — they are linted as
 * text at a path inside engine/ — so they cannot rot into real files.
 */
const CWD = fileURLToPath(new URL("../../", import.meta.url));
const eslint = new ESLint({ cwd: CWD });

async function lintAsEngine(code: string) {
  const results = await eslint.lintText(code, {
    filePath: `${CWD}engine/__probe__.ts`,
    warnIgnored: false
  });
  return results[0]?.messages ?? [];
}

describe("engine purity is enforced, not merely documented", () => {
  it("blocks React imports", async () => {
    const messages = await lintAsEngine(`import { useState } from "react";\nexport const a = useState;\n`);
    expect(messages.map((m) => m.message).join(" ")).toMatch(/must not import React/);
  });

  it("blocks Next.js imports", async () => {
    const messages = await lintAsEngine(`import { headers } from "next/headers";\nexport const a = headers;\n`);
    expect(messages.map((m) => m.message).join(" ")).toMatch(/must not import Next\.js/);
  });

  it("blocks Supabase imports", async () => {
    const messages = await lintAsEngine(
      `import { createClient } from "@supabase/supabase-js";\nexport const a = createClient;\n`
    );
    expect(messages.map((m) => m.message).join(" ")).toMatch(/must not import Supabase/);
  });

  it("blocks file system access", async () => {
    const messages = await lintAsEngine(`import { readFileSync } from "node:fs";\nexport const a = readFileSync;\n`);
    expect(messages.map((m) => m.message).join(" ")).toMatch(/must not touch the file system/);
  });

  it("blocks importing the dataset loader", async () => {
    const messages = await lintAsEngine(`import { loadDatasets } from "../data/loader";\nexport const a = loadDatasets;\n`);
    expect(messages.map((m) => m.message).join(" ")).toMatch(/must not import the dataset loader/);
  });

  it("blocks importing adapters and services", async () => {
    const adapters = await lintAsEngine(`import { x } from "../adapters/llm/gemini";\nexport const a = x;\n`);
    expect(adapters.map((m) => m.message).join(" ")).toMatch(/must not import adapters/);

    const services = await lintAsEngine(`import { y } from "../services/project.service";\nexport const b = y;\n`);
    expect(services.map((m) => m.message).join(" ")).toMatch(/must not import services/);
  });

  it("blocks network calls", async () => {
    const messages = await lintAsEngine(`export const a = () => fetch("https://example.com");\n`);
    expect(messages.map((m) => m.message).join(" ")).toMatch(/must not perform network I\/O/);
  });

  it("blocks non-determinism", async () => {
    const now = await lintAsEngine(`export const a = () => Date.now();\n`);
    expect(now.map((m) => m.message).join(" ")).toMatch(/inject ClockPort/);

    const date = await lintAsEngine(`export const b = () => new Date();\n`);
    expect(date.map((m) => m.message).join(" ")).toMatch(/inject ClockPort/);

    const random = await lintAsEngine(`export const c = () => Math.random();\n`);
    expect(random.map((m) => m.message).join(" ")).toMatch(/no Math\.random/);
  });

  it("allows what the engine is supposed to use", async () => {
    const messages = await lintAsEngine(
      `import { z } from "zod";\nimport type { DatasetRegistry } from "../types/datasets";\nexport const a = (d: DatasetRegistry) => z.string().parse(d.version);\n`
    );
    expect(messages.filter((m) => m.severity === 2)).toHaveLength(0);
  });
});

describe("the real engine source obeys the rule", () => {
  it("lints clean across every engine file", async () => {
    const results = await eslint.lintFiles([`${CWD}engine/**/*.ts`]);
    const errors = results.flatMap((result) =>
      result.messages.filter((message) => message.severity === 2).map((message) => `${result.filePath}: ${message.message}`)
    );
    expect(errors).toEqual([]);
    expect(results.length).toBeGreaterThan(5);
  });
});

describe("the visual-generation boundary holds (P2.11)", () => {
  it("blocks the engine from importing the visual-generation adapter or client", async () => {
    const fake = await lintAsEngine(
      `import { createFakeVisualGeneration } from "../adapters/visual-generation/fake";\nexport const a = createFakeVisualGeneration;\n`
    );
    expect(fake.filter((m) => m.severity === 2).length).toBeGreaterThan(0);

    const client = await lintAsEngine(
      `import { createVisualGenerationClient } from "../adapters/visual-generation/client";\nexport const b = createVisualGenerationClient;\n`
    );
    expect(client.filter((m) => m.severity === 2).length).toBeGreaterThan(0);
  });

  it("blocks the engine from importing the generation service", async () => {
    const messages = await lintAsEngine(
      `import { runVisualGeneration } from "../services/generation.service";\nexport const a = runVisualGeneration;\n`
    );
    expect(messages.filter((m) => m.severity === 2).length).toBeGreaterThan(0);
  });

  it("allows the engine to depend on the visual-generation port type", async () => {
    const messages = await lintAsEngine(
      `import type { VisualGenerationPort } from "../ports/visual-generation.port";\nexport const a = (p: VisualGenerationPort) => p;\n`
    );
    expect(messages.filter((m) => m.severity === 2)).toHaveLength(0);
  });
});

describe("the LLM boundary holds", () => {
  it("blocks the engine from importing a provider adapter directly", async () => {
    const gemini = await lintAsEngine(
      `import { createGeminiCall } from "../adapters/llm/gemini";\nexport const a = createGeminiCall;\n`
    );
    expect(gemini.filter((m) => m.severity === 2).length).toBeGreaterThan(0);

    const client = await lintAsEngine(
      `import { createStructuredClient } from "../adapters/llm/structured-client";\nexport const b = createStructuredClient;\n`
    );
    expect(client.filter((m) => m.severity === 2).length).toBeGreaterThan(0);
  });

  it("blocks the engine from importing the cost service", async () => {
    const messages = await lintAsEngine(
      `import { createCostLedger } from "../services/cost.service";\nexport const a = createCostLedger;\n`
    );
    expect(messages.filter((m) => m.severity === 2).length).toBeGreaterThan(0);
  });

  it("allows the engine to depend on the LLM port", async () => {
    const messages = await lintAsEngine(
      `import type { LlmPort } from "../ports/llm.port";\nexport const a = (llm: LlmPort) => llm;\n`
    );
    expect(messages.filter((m) => m.severity === 2)).toHaveLength(0);
  });

  it("finds no provider name in engine CODE (comments may still discuss them)", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
      });

    // Comments are stripped first: a doc comment explaining that swapping
    // Gemini for Anthropic changes nothing is exactly the kind of note that
    // should survive, while any provider reference in real code must not.
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

    const offenders = walk(join(process.cwd(), "engine")).filter((file) =>
      /\b(gemini|generativelanguage|anthropic|openai|x-goog-api-key)\b/i.test(
        stripComments(readFileSync(file, "utf8"))
      )
    );
    expect(offenders).toEqual([]);
  });
});
