import { describe, expect, it } from "vitest";
import { datasets, clock, newIds } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { normalizeBrief } from "../../engine/brief/normalize";
import { progressiveBriefing } from "../../engine/brief/progressive-briefing";
import { checkCompleteness } from "../../engine/brief/completeness";
import { evaluateReadiness } from "../../engine/brief/readiness";
import { buildExtractionSchema } from "../../engine/brief/extraction";
import { llmFixture, RAW_INDONESIAN_BRIEF } from "../fixtures/llm/raw";

/**
 * P2.3.2e — Unify Readiness Gate.
 *
 * Before this change, `normalize.ts` decided brief usability with its own
 * `checkCompleteness().ready` gate, while `progressive-briefing.ts` decided
 * it again with `evaluateReadiness()`. The two happened to agree on the
 * seven-field case but diverged on contradictions: a brief with every
 * blocking field present but a reported contradiction would pass the old
 * completeness gate and build a NormalizedBrief, which progressiveBriefing
 * then had to discard by re-checking readiness itself.
 *
 * These tests prove there is now exactly one decision, made once, agreed on
 * everywhere it is consulted.
 */

const ledger = () => createCostLedger({ clock });
const schema = buildExtractionSchema(datasets);
const parse = (name: string) => schema.parse(JSON.parse(llmFixture(name)));

const runNormalize = async (fixtureName: string) => {
  const fake = createFakeLlm([{ text: llmFixture(fixtureName) }], { ledger: ledger(), clock });
  return normalizeBrief({
    rawBrief: RAW_INDONESIAN_BRIEF,
    projectId: "proj_unify",
    datasets,
    llm: fake.port,
    ids: newIds()
  });
};

const runProgressive = async (fixtureName: string) => {
  const fake = createFakeLlm([{ text: llmFixture(fixtureName) }], { ledger: ledger(), clock });
  return progressiveBriefing({
    rawBrief: RAW_INDONESIAN_BRIEF,
    projectId: "proj_unify",
    datasets,
    llm: fake.port,
    ids: newIds()
  });
};

const FIXTURES = [
  "01-valid-indonesian",
  "02-very-short",
  "05-missing-objective",
  "10-contradictions",
  "11-invented-mandatory"
] as const;

describe("P2.3.2e — evaluateReadiness is the single authoritative gate", () => {
  describe("A. evaluateReadiness decides brief presence everywhere it is consulted", () => {
    it.each(FIXTURES)("normalizeBrief(%s): brief is non-null iff readiness.status is READY", async (name) => {
      const result = await runNormalize(name);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.readiness.status).toBe(evaluateReadiness(parse(name)).status);
      expect(result.value.brief !== null).toBe(result.value.readiness.status === "READY");
    });
  });

  describe("B. normalize and progressiveBriefing agree", () => {
    it.each(FIXTURES)("%s produces the same readiness and brief-nullness through both entry points", async (name) => {
      const [direct, progressive] = await Promise.all([runNormalize(name), runProgressive(name)]);
      expect(direct.ok).toBe(true);
      expect(progressive.ok).toBe(true);
      if (!direct.ok || !progressive.ok) return;

      expect(progressive.value.readiness).toEqual(direct.value.readiness);
      expect(progressive.value.brief !== null).toBe(direct.value.brief !== null);
      expect(progressive.value.brief).toEqual(direct.value.brief);
    });
  });

  describe("C. completeness.ts no longer computes an independent blocking-field list", () => {
    it.each(FIXTURES)("checkCompleteness(%s) delegates blocking_fields and ready to evaluateReadiness", (name) => {
      const extraction = parse(name);
      const readiness = evaluateReadiness(extraction);
      const completeness = checkCompleteness(extraction);

      expect(completeness.blocking_fields).toEqual(readiness.blocking_fields);
      expect(completeness.ready).toBe(readiness.status === "READY");
    });

    it("a contradictory-but-otherwise-complete brief is not ready — the bug the old dual gate allowed", () => {
      // Every BLOCKING_FIELDS entry is present in this fixture; only the
      // reported contradiction makes it unusable. The old completeness gate
      // looked only at field presence and would have called this ready.
      const extraction = parse("10-contradictions");
      const completeness = checkCompleteness(extraction);
      expect(completeness.blocking_fields).toHaveLength(0);
      expect(completeness.ready).toBe(false);
    });
  });

  describe("D. READY", () => {
    it("a complete brief normalizes straight through with no clarification needed", async () => {
      const result = await runNormalize("01-valid-indonesian");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.readiness.status).toBe("READY");
      expect(result.value.readiness.questions).toHaveLength(0);
      expect(result.value.brief).not.toBeNull();
    });
  });

  describe("E. NEEDS_CLARIFICATION", () => {
    it("a brief missing only the objective asks exactly for that and withholds the brief", async () => {
      const result = await runNormalize("05-missing-objective");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.readiness.status).toBe("NEEDS_CLARIFICATION");
      expect(result.value.readiness.questions.some((q) => q.field === "objective")).toBe(true);
      expect(result.value.brief).toBeNull();
    });

    it("a very short brief with several missing fields still withholds the brief", async () => {
      const result = await runNormalize("02-very-short");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.readiness.status).toBe("NEEDS_CLARIFICATION");
      expect(result.value.brief).toBeNull();
    });
  });

  describe("F. INVALID", () => {
    it("a contradictory brief is rejected even though every field is otherwise present", async () => {
      const result = await runNormalize("10-contradictions");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.readiness.status).toBe("INVALID");
      expect(result.value.readiness.error).toContain("contradict");
      expect(result.value.brief).toBeNull();
    });
  });
});
