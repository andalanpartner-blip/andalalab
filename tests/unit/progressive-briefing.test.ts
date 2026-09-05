import { describe, expect, it } from "vitest";
import { datasets, clock, newIds } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { progressiveBriefing, formatClarificationRequest, appendClarificationAnswers } from "../../engine/brief/progressive-briefing";
import { llmFixture, RAW_INDONESIAN_BRIEF } from "../fixtures/llm/raw";

const ledger = () => createCostLedger({ clock });

describe("Progressive Briefing", () => {
  describe("Clarification formatting", () => {
    it("formats a clarification request with plain Indonesian", () => {
      const clarification = {
        status: "NEEDS_CLARIFICATION" as const,
        questions: [
          { field: "objective", question: "Tujuan utama materi ini apa?" },
          { field: "channel", question: "Materi ini untuk Instagram atau Facebook?" }
        ],
        blocking_fields: [],
        missing_fields: [],
        derived_fields: []
      };

      const formatted = formatClarificationRequest(clarification);
      expect(formatted).toContain("klarifikasi");
      expect(formatted).toContain("Tujuan utama");
      expect(formatted).toContain("1.");
      expect(formatted).toContain("2.");
    });

    it("returns empty string for READY status", () => {
      const ready = {
        status: "READY" as const,
        blocking_fields: [],
        missing_fields: [],
        derived_fields: [],
        questions: []
      };
      const formatted = formatClarificationRequest(ready);
      expect(formatted).toBe("");
    });

    it("returns empty string when there are no questions", () => {
      const needsClarity = {
        status: "NEEDS_CLARIFICATION" as const,
        questions: [],
        blocking_fields: [],
        missing_fields: [],
        derived_fields: []
      };
      const formatted = formatClarificationRequest(needsClarity);
      expect(formatted).toBe("");
    });
  });

  describe("Answer appending", () => {
    it("appends user answers to the original brief", () => {
      const original = "Buat poster grand opening coffee shop baru di Solo, target anak muda.";
      const answers = {
        objective: "Kami fokus pada peluncuran dan promosi grand opening.",
        channel: "Instagram Feed"
      };
      const result = appendClarificationAnswers(original, answers);
      expect(result).toContain(original);
      expect(result).toContain("grand opening");
      expect(result).toContain("Instagram Feed");
    });

    it("preserves original brief text", () => {
      const original = "Buat poster grand opening.";
      const answers = { channel: "Instagram Feed" };
      const result = appendClarificationAnswers(original, answers);
      expect(result).toContain("grand opening");
    });

    it("returns original brief if answers are empty", () => {
      const original = "Buat poster grand opening.";
      const answers = { channel: "", objective: null as unknown as string };
      const result = appendClarificationAnswers(original, answers);
      expect(result).toBe(original);
    });

    it("handles multiple answers", () => {
      const original = "Brief text.";
      const answers = {
        answer1: "First answer",
        answer2: "Second answer",
        answer3: "Third answer"
      };
      const result = appendClarificationAnswers(original, answers);
      expect(result).toContain("First answer");
      expect(result).toContain("Second answer");
      expect(result).toContain("Third answer");
    });
  });

  describe("Re-normalization flow", () => {
    it("re-normalizes after user answers", () => {
      const originalBrief = "Buat konten untuk brand yang baru.";
      const answers = {
        objective: "Awareness untuk peluncuran produk baru.",
        audience: "Profesional muda usia 25-35.",
        channel: "Instagram Feed",
        country: "Indonesia"
      };

      const enhancedBrief = appendClarificationAnswers(originalBrief, answers);

      // Verify the appending works
      expect(enhancedBrief.toLowerCase()).toContain("awareness");
      expect(enhancedBrief).toContain("Profesional");
      expect(enhancedBrief).toContain("Instagram Feed");
      expect(enhancedBrief).toContain("Indonesia");
    });
  });

  describe("Progressive briefing with mock LLM", () => {
    const run = async (script: Parameters<typeof createFakeLlm>[0], raw = RAW_INDONESIAN_BRIEF) => {
      const book = ledger();
      const fake = createFakeLlm(script, { ledger: book, clock });
      const result = await progressiveBriefing({
        rawBrief: raw,
        projectId: "proj_brief",
        datasets,
        llm: fake.port,
        ids: newIds()
      });
      return { result, book, fake };
    };

    it("returns READY status for complete briefs", async () => {
      const { result } = await run([{ text: llmFixture("01-valid-indonesian") }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.readiness.status).toBe("READY");
      expect(result.value.brief).not.toBeNull();
    });

    it("returns NEEDS_CLARIFICATION for incomplete briefs", async () => {
      const { result } = await run([{ text: llmFixture("05-missing-objective") }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.readiness.status).toBe("NEEDS_CLARIFICATION");
      expect(result.value.readiness.questions.length).toBeGreaterThan(0);
      expect(result.value.brief).toBeNull();
    });

    it("returns extraction for re-normalization", async () => {
      const { result } = await run([{ text: llmFixture("01-valid-indonesian") }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.extraction).toBeDefined();
      expect(result.value.extraction.audience.description).toBeDefined();
    });

    it("includes warnings from normalization", async () => {
      const { result } = await run([{ text: llmFixture("11-invented-mandatory") }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.warnings.some((line) => line.includes("Possible invention"))).toBe(true);
    });

    it("handles contradictory briefs as INVALID", async () => {
      const { result } = await run([{ text: llmFixture("10-contradictions") }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.readiness.status).toBe("INVALID");
      expect(result.value.brief).toBeNull();
    });
  });
});
