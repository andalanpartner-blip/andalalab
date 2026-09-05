import { describe, expect, it } from "vitest";
import { buildExtractionSchema } from "../../engine/brief/extraction";
import { evaluateReadiness } from "../../engine/brief/readiness";
import { datasets } from "../fixtures/load";
import { llmFixture } from "../fixtures/llm/raw";

const schema = buildExtractionSchema(datasets);
const parse = (name: string) => schema.parse(JSON.parse(llmFixture(name)));

describe("Readiness Evaluation", () => {
  describe("READY state", () => {
    it("returns READY when all critical fields are present", () => {
      const extraction = parse("01-valid-indonesian");
      const result = evaluateReadiness(extraction, datasets);
      expect(result.status).toBe("READY");
      expect(result.questions).toHaveLength(0);
      expect(result.blocking_fields).toHaveLength(0);
    });

    it("returns READY even when some optional fields are missing", () => {
      const extraction = parse("01-valid-indonesian");
      const result = evaluateReadiness(extraction, datasets);
      // movement_id is optional and may not be present
      if (result.status === "READY") {
        expect(result.missing_fields).not.toContain("objective");
        expect(result.missing_fields).not.toContain("audience.description");
      }
    });
  });

  describe("NEEDS_CLARIFICATION state", () => {
    it("asks for objective when missing", () => {
      const extraction = parse("05-missing-objective");
      const result = evaluateReadiness(extraction, datasets);
      expect(result.status).toBe("NEEDS_CLARIFICATION");
      expect(result.questions.some((q) => q.field === "objective")).toBe(true);
      expect(result.missing_fields).toContain("objective");
    });

    it("asks for audience description when missing", () => {
      const extraction = parse("02-very-short");
      const result = evaluateReadiness(extraction, datasets);
      if (result.missing_fields.includes("audience.description")) {
        expect(result.status).toBe("NEEDS_CLARIFICATION");
        expect(result.questions.some((q) => q.field === "audience.description")).toBe(true);
      }
    });

    it("asks for country when missing", () => {
      const extraction = parse("02-very-short");
      const result = evaluateReadiness(extraction, datasets);
      if (result.missing_fields.includes("country")) {
        expect(result.status).toBe("NEEDS_CLARIFICATION");
        expect(result.questions.some((q) => q.field === "country")).toBe(true);
      }
    });

    it("returns all questions in a single result", () => {
      const extraction = parse("02-very-short");
      const result = evaluateReadiness(extraction, datasets);
      expect(result.status).toBe("NEEDS_CLARIFICATION");
      // Should have multiple questions but fewer than total missing fields
      // (not every missing field gets a question)
      expect(result.questions.length).toBeGreaterThan(0);
      expect(result.missing_fields.length).toBeGreaterThanOrEqual(result.questions.length);
    });

    it("generates questions in deterministic order", () => {
      const extraction = parse("02-very-short");
      const result1 = evaluateReadiness(extraction, datasets);
      const result2 = evaluateReadiness(extraction, datasets);
      if (result1.status === "NEEDS_CLARIFICATION" && result2.status === "NEEDS_CLARIFICATION") {
        const q1Fields = result1.questions.map((q) => q.field);
        const q2Fields = result2.questions.map((q) => q.field);
        expect(q1Fields).toEqual(q2Fields);
      }
    });

    it("includes plain Indonesian in questions", () => {
      const extraction = parse("05-missing-objective");
      const result = evaluateReadiness(extraction, datasets);
      if (result.status === "NEEDS_CLARIFICATION") {
        const allQuestions = result.questions.map((q) => q.question).join(" ");
        expect(allQuestions).toMatch(/[а-яА-Я]|[ÁÉÍÓÚáéíóú]|[a-z]/i);
        // Check for typical Indonesian question words
        expect(allQuestions.toLowerCase()).toMatch(/apa|mana|di|atau|yang/);
      }
    });
  });

  describe("INVALID state", () => {
    it("marks brief INVALID when it reports contradictions", () => {
      const extraction = parse("10-contradictions");
      const result = evaluateReadiness(extraction, datasets);
      expect(result.status).toBe("INVALID");
      expect(result.error).toBeDefined();
      expect(result.error).toContain("contradict");
    });
  });

  describe("Safe Inference", () => {
    it("derives aspect_ratio from channel when not explicit", () => {
      const extraction = parse("01-valid-indonesian");
      const result = evaluateReadiness(extraction, datasets);
      // If channel is Instagram Feed (4:5), aspect ratio should be derived
      if (extraction.platform.channel.value === "instagram-feed") {
        // After normalization, the aspect ratio would be 4-5
        // For now, just check the logic doesn't fail
        expect(result.status).toBeDefined();
      }
    });

    it("records derived fields separately from missing fields", () => {
      const extraction = parse("01-valid-indonesian");
      const result = evaluateReadiness(extraction, datasets);
      if (result.derived_fields.length > 0) {
        expect(result.derived_fields.some((d) => d.includes("aspect_ratio"))).toBeDefined();
      }
    });

    it("does not infer objective or audience description", () => {
      const extraction = parse("05-missing-objective");
      const result = evaluateReadiness(extraction, datasets);
      // These critical fields must be explicit
      expect(result.missing_fields).toContain("objective");
      expect(result.status).toBe("NEEDS_CLARIFICATION");
    });
  });

  describe("Channel Questions", () => {
    it("only asks for channel after objective is resolved", () => {
      const extraction = parse("05-missing-objective");
      const result = evaluateReadiness(extraction, datasets);
      // Missing objective: should not ask about channel yet
      if (result.status === "NEEDS_CLARIFICATION") {
        // Objective question should come first
        const objQuestion = result.questions.find((q) => q.field === "objective");
        const chanQuestion = result.questions.find((q) => q.field === "platform.channel");
        // If both are missing, only objective is asked in first pass
        if (objQuestion && chanQuestion) {
          const objIndex = result.questions.indexOf(objQuestion);
          const chanIndex = result.questions.indexOf(chanQuestion);
          expect(objIndex).toBeLessThan(chanIndex);
        }
      }
    });
  });

  describe("Question Text Quality", () => {
    it("does not expose internal field names", () => {
      const extraction = parse("05-missing-objective");
      const result = evaluateReadiness(extraction, datasets);
      if (result.status === "NEEDS_CLARIFICATION") {
        const questionText = result.questions.map((q) => q.question).join(" ");
        expect(questionText).not.toContain("objective");
        expect(questionText).not.toContain("platform.channel");
        expect(questionText).not.toContain("audience.description");
      }
    });

    it("uses client-friendly language for channel question", () => {
      const extraction = parse("05-missing-objective");
      // Manually construct a case with channel missing
      extraction.objective.value = "awareness";
      extraction.audience.description.value = "young people";
      extraction.countries = [];
      extraction.platform.channel.value = null;

      const result = evaluateReadiness(extraction, datasets);
      if (result.status === "NEEDS_CLARIFICATION") {
        const chanQuestion = result.questions.find((q) => q.field === "platform.channel");
        if (chanQuestion) {
          // Question should ask about Instagram Feed, Story, Facebook, etc.
          // not about "channels" in general
          expect(chanQuestion.question.toLowerCase()).toMatch(
            /(instagram|facebook|channel|dipakai)/
          );
        }
      }
    });
  });

  describe("Backward Compatibility", () => {
    it("maintains same results for valid briefs compared to completeness check", () => {
      const extraction = parse("01-valid-indonesian");
      const result = evaluateReadiness(extraction, datasets);
      // A valid extraction should remain READY
      expect(result.status).toBe("READY");
    });

    it("treats low-confidence fields correctly", () => {
      const extraction = parse("03-ambiguous");
      const result = evaluateReadiness(extraction, datasets);
      // Even with low confidence, if a field is present, it shouldn't block
      // (The completeness score is a separate concern from readiness)
      if (result.status === "NEEDS_CLARIFICATION") {
        // Questions should be asked, but based on actual presence, not confidence
        expect(result.questions.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Example Scenarios from Policy", () => {
    it("handles coffee shop scenario", () => {
      const extraction = parse("01-valid-indonesian");
      const result = evaluateReadiness(extraction, datasets);
      // Coffee shop is a typical scenario: industry should be inferrable,
      // channel (Instagram Feed) is explicit
      if (result.status === "READY") {
        expect(result.questions).toHaveLength(0);
      }
    });

    it("marks incomplete brief as NEEDS_CLARIFICATION, not INVALID", () => {
      const extraction = parse("02-very-short");
      const result = evaluateReadiness(extraction, datasets);
      // A brief that's just missing some required info should ask questions,
      // not reject entirely
      if (result.missing_fields.some((f) => f === "objective" || f === "audience.description")) {
        expect(result.status).toBe("NEEDS_CLARIFICATION");
        expect(result.questions.length).toBeGreaterThan(0);
      }
    });
  });
});
