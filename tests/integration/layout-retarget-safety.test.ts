import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { datasets, pipeline, newIds, clock } from "../fixtures/load";
import { runLayoutRetargetPipeline } from "../../services/pipeline.service";

/**
 * Changing the visual layout template re-derives design STRUCTURE only. It must
 * never generate an image, call the vision loop / evidence, run a correction or
 * record an approval. Enforced structurally (imports) and behaviourally.
 */

const ROOT = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("layout retarget — no generation / vision / critic / correction", () => {
  const forbidden = [
    /generation\.service|runVisualGeneration|VisualGenerationPort/,
    /vision-loop\.service|inspectGeneratedVisual|evidence\.service|VisualEvidence/,
    /correction\.service|applyCorrection|runCorrectionPipeline/,
    /decision\.service|CreativeDecision|approve/,
    /gemini|GEMINI_API_KEY|createGeminiLlm/i
  ];

  it("14/15/16/17 — the retarget engine module imports nothing that generates, sees or corrects", () => {
    const src = stripComments(read("engine/layout/retarget.ts"));
    for (const pattern of forbidden) expect(src).not.toMatch(pattern);
    // it only composes the direction + recipe builders
    expect(src).toMatch(/buildDesignDirection/);
    expect(src).toMatch(/buildDesignRecipe/);
  });

  it("14/15/16/17 — the /api/layout route calls no generate / vision-loop / decision route or service", () => {
    const src = stripComments(read("app/api/layout/route.ts"));
    for (const pattern of forbidden) expect(src).not.toMatch(pattern);
    expect(src).toMatch(/runLayoutRetargetPipeline/);
  });

  it("the retarget pipeline function itself pulls in no generation / vision / correction", () => {
    // isolate runLayoutRetargetPipeline's body from the shared services file
    const file = read("services/pipeline.service.ts");
    const start = file.indexOf("export function runLayoutRetargetPipeline");
    const body = stripComments(file.slice(start, file.indexOf("\n}\n", start)));
    expect(body).not.toMatch(/runVisualGeneration|inspectGeneratedVisual|applyCorrection|reviewDesign/);
    // it does compile the prompt + resolve a fresh blueprint + run the deterministic (no-model) critic
    expect(body).toMatch(/compilePromptSet/);
    expect(body).toMatch(/resolveLayoutBlueprint/);
  });

  it("behaviour: a retarget returns a fresh recipe/blueprint/prompt and never an artifact or decision", () => {
    const { contract, direction, recipe } = pipeline("web-hero-saas-launch");
    const result = runLayoutRetargetPipeline(
      { datasets, ids: newIds(), clock },
      { contract, direction, parentRecipe: recipe, layoutId: "web-hero-split" }
    );
    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(
      ["blueprint", "contract", "critic", "direction", "layoutTemplates", "promptSet", "recipe", "status"].sort()
    );
    // no image / decision / evidence anywhere in the payload
    expect(JSON.stringify(result)).not.toMatch(/imageBase64|data:image|artifact_hash|"decision"/);
  });

  it("20 — the templates grid CSS is fluid: no fixed widths, columns collapse for mobile", () => {
    const grid = read("components/workspace/LayoutTemplates.module.css");
    expect(grid).toMatch(/\.grid\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(grid).toMatch(/@media \(min-width: 640px\)[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
    expect(grid).toMatch(/@media \(min-width: 1200px\)[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
    // schematic frame is width:100% — never a fixed pixel width that could overflow
    const schem = read("components/workspace/LayoutSchematic.module.css");
    expect(schem).toMatch(/\.frame\s*\{[^}]*width:\s*100%/);
    expect(schem).not.toMatch(/\.card[^{]*\{[^}]*width:\s*\d+px/);
  });

  it("18 — a human override is recorded through the existing Decision Ledger (no new ledger)", () => {
    const ledger = read("components/DecisionLedger.tsx");
    expect(ledger).toMatch(/layoutOverride/);
    expect(ledger).toMatch(/AI recommended/);
    expect(ledger).toMatch(/Designer selected/);
    const ws = read("components/workspace/Workspace.tsx");
    // the override is set only when the applied template differs from the AI's
    // ORIGINAL recommendation (frozen at recipe-build time)
    expect(ws).toMatch(/next\.appliedTemplate\.id !== aiLayoutRec\.templateId/);
    expect(ws).toMatch(/setLayoutOverride\(\{/);
    expect(ws).toMatch(/setAiLayoutRec\(\{[\s\S]*?recommendedTemplateId/);
    // it flows into the same DecisionLedger component, not a new one
    expect(ws).toMatch(/<DecisionLedger[\s\S]*?layoutOverride=\{layoutOverride\}/);
  });
});
