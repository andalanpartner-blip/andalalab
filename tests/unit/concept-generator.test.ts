import { describe, expect, it } from "vitest";
import { clock, datasets, newIds, pipeline } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { generateConcepts } from "../../engine/concept/generate";
import { conceptFixtureText, conceptFixture } from "../fixtures/concepts/load";
import { CONCEPT_TEMPLATE_VERSION, MAX_CONCEPT_CALLS } from "../../engine/concept/config";
import { buildConceptPrompt } from "../../engine/concept/prompts/concept-generator";

const { contract, direction } = pipeline("kopi-lawas-promotion");

const run = async (script: { text: string }[]) => {
  const ledger = createCostLedger({ clock });
  const fake = createFakeLlm(script, { ledger, clock });
  const result = await generateConcepts({
    projectId: "proj_concepts",
    contract,
    direction,
    datasets,
    llm: fake.port,
    ids: newIds(),
    clock
  });
  return { result, ledger, fake };
};

const only = (name: string, index: number): string =>
  JSON.stringify({ concepts: [conceptFixture(name).concepts[index]] });

describe("the concept prompt separates brief, direction and concept", () => {
  const prompt = buildConceptPrompt({ contract, direction, datasets, count: 3 });

  it("labels all three sections", () => {
    expect(prompt).toContain("=== BRIEF");
    expect(prompt).toContain("=== DIRECTION");
    expect(prompt).toContain("=== CONCEPT");
  });

  it("states every prohibition the specification requires", () => {
    for (const line of [
      "Do not redesign the design direction.",
      "Do not change the assigned movement.",
      "Do not change the layout grammar.",
      "Do not change DKV parameters.",
      "Do not invent a new industry interpretation.",
      "Do not create concepts that violate mandatory constraints."
    ]) {
      expect(prompt).toContain(line);
    }
  });

  it("passes the decided direction to the model as context", () => {
    expect(prompt).toContain("Movement:");
    expect(prompt).toContain("Layout grammar:");
    expect(prompt).toContain("DKV targets:");
    expect(prompt).toContain("Cultural influence:");
  });

  it("shows what a concept is and what execution is", () => {
    expect(prompt).toContain("Example of a CONCEPT");
    expect(prompt).toContain("Example of EXECUTION, which is NOT wanted");
  });

  it("forbids cultural motifs explicitly", () => {
    expect(prompt).toMatch(/Never as a national\s+symbol, script, flower, pattern or landmark/);
  });
});

describe("successful generation", () => {
  it("produces three scored concepts on one model call", async () => {
    const { result, fake, ledger } = await run([{ text: conceptFixtureText("valid-set") }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(fake.callCount()).toBe(1);
    expect(result.value.calls).toBe(1);
    expect(result.value.concepts).toHaveLength(3);
    expect(result.value.diversity.passed).toBe(true);
    expect(ledger.list("proj_concepts")).toHaveLength(1);
    expect(ledger.list("proj_concepts")[0]?.prompt_template_version).toBe(CONCEPT_TEMPLATE_VERSION);
  });

  it("selects deterministically by engine score, not by model order", async () => {
    const first = await run([{ text: conceptFixtureText("valid-set") }]);
    const second = await run([{ text: conceptFixtureText("valid-set") }]);
    if (!first.result.ok || !second.result.ok) throw new Error("expected success");

    expect(second.result.value.selected.concept_hash).toBe(
      first.result.value.selected.concept_hash
    );
    // Concepts come back ranked, so the selection is the top of the list.
    expect(first.result.value.selected.id).toBe(first.result.value.concepts[0]!.id);
    const totals = first.result.value.concepts.map((c) => c.score.total);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });

  it("treats the model's self_score as advisory and never as authority", async () => {
    const batch = conceptFixture("valid-set");
    // The weakest concept claims a perfect score for itself.
    const gamed = {
      concepts: batch.concepts.map((c, i) => (i === 2 ? { ...c, self_score: 1 } : c))
    };
    const { result } = await run([{ text: JSON.stringify(gamed) }]);
    if (!result.ok) throw new Error("expected success");

    const claimed = result.value.concepts.find((c) => c.score.model_advisory === 1);
    expect(claimed).toBeDefined();
    expect(claimed!.score.total).not.toBe(1);
    expect(result.value.selected.score.total).toBeGreaterThan(0);
  });

  it("gives every concept a hash and a scored breakdown", async () => {
    const { result } = await run([{ text: conceptFixtureText("valid-set") }]);
    if (!result.ok) throw new Error("expected success");
    for (const concept of result.value.concepts) {
      expect(concept.concept_hash).toHaveLength(8);
      expect(concept.score.breakdown).toHaveLength(9);
      expect(concept.direction_id).toBe(direction.id);
    }
  });
});

describe("rejection and regeneration", () => {
  it("rejects generic concepts and regenerates once", async () => {
    const { result, fake } = await run([
      { text: conceptFixtureText("generic-response") },
      { text: conceptFixtureText("valid-set") }
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(fake.callCount()).toBe(2);
    expect(result.value.rejected.length).toBeGreaterThanOrEqual(2);
    expect(
      result.value.rejected.some((r) => r.issues.some((i) => i.code === "GENERIC_LANGUAGE"))
    ).toBe(true);
    expect(result.value.concepts.length).toBeGreaterThan(0);
  });

  it("regenerates only the duplicate, keeping what was accepted", async () => {
    const dupeBatch = conceptFixture("near-duplicate").concepts;
    const valid = conceptFixture("valid-set").concepts;
    const script = [
      { text: JSON.stringify({ concepts: [dupeBatch[0]!, dupeBatch[1]!, valid[1]!] }) },
      { text: only("valid-set", 2) }
    ];
    const { result, fake } = await run(script);
    if (!result.ok) throw new Error("expected success");

    expect(fake.callCount()).toBe(2);
    // The regeneration prompt names the kept concepts so the model cannot
    // simply repeat one of them.
    expect(fake.prompts[1]).toContain("=== REGENERATION ===");
    expect(fake.prompts[1]).toContain("These concepts are being kept");
    expect(result.value.diversity.passed).toBe(true);
  });

  it("never makes a third call", async () => {
    const { result, fake } = await run([
      { text: conceptFixtureText("generic-response") },
      { text: conceptFixtureText("generic-response") },
      { text: conceptFixtureText("valid-set") }
    ]);
    expect(fake.callCount()).toBe(MAX_CONCEPT_CALLS);
    expect(result.ok).toBe(false);
  });

  it("drops a duplicate rather than shipping it when regeneration fails", async () => {
    const dupes = conceptFixture("near-duplicate").concepts;
    const { result } = await run([
      { text: JSON.stringify({ concepts: [dupes[0]!, dupes[1]!] }) },
      { text: JSON.stringify({ concepts: [dupes[1]!] }) }
    ]);
    if (!result.ok) throw new Error("expected a short but clean set");
    expect(result.value.diversity.passed).toBe(true);
    expect(result.value.rejected.some((r) => r.issues.some((i) => i.code === "NEAR_DUPLICATE"))).toBe(
      true
    );
  });

  it("fails typed when nothing survives", async () => {
    const { result } = await run([
      { text: conceptFixtureText("cultural-stereotype") },
      { text: conceptFixtureText("cultural-stereotype") }
    ]);
    expect(result.ok).toBe(false);
  });
});
