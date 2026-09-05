/**
 * Offline tests for the Real Brief Evaluation Harness.
 *
 * These tests are deterministic and do NOT contact Gemini.
 * They verify the field comparison and metric calculation logic.
 */

import { describe, expect, it } from "vitest";
import {
  compareCountryBlend,
  compareAudience,
  calculateMetrics,
  buildEvaluationReport
} from "../../scripts/evaluate-briefs";

describe("evaluate-briefs comparison helpers", () => {
  describe("compareCountryBlend", () => {
    it("returns true when country blends match within tolerance", () => {
      const expected = { indonesia: 0.75, japan: 0.25 };
      const actual = { indonesia: 0.74, japan: 0.26 };
      expect(compareCountryBlend(expected, actual, 0.15)).toBe(true);
    });

    it("returns false when country blends differ beyond tolerance", () => {
      const expected = { indonesia: 0.75, japan: 0.25 };
      const actual = { indonesia: 0.5, japan: 0.5 };
      expect(compareCountryBlend(expected, actual, 0.15)).toBe(false);
    });

    it("returns false when actual is undefined", () => {
      const expected = { indonesia: 1.0 };
      expect(compareCountryBlend(expected, undefined, 0.15)).toBe(false);
    });

    it("returns false when actual has no countries", () => {
      const expected = { indonesia: 1.0 };
      const actual: Record<string, number> = {};
      expect(compareCountryBlend(expected, actual, 0.15)).toBe(false);
    });

    it("handles single country correctly", () => {
      const expected = { indonesia: 1.0 };
      const actual = { indonesia: 1.0 };
      expect(compareCountryBlend(expected, actual, 0.15)).toBe(true);
    });

    it("allows different country sets within tolerance", () => {
      const expected = { indonesia: 0.8, japan: 0.2 };
      const actual = { indonesia: 0.85, japan: 0.15 };
      expect(compareCountryBlend(expected, actual, 0.1)).toBe(true);
    });

    it("uses custom tolerance correctly", () => {
      const expected = { indonesia: 0.8 };
      const actual = { indonesia: 0.7 };
      // 0.1 difference with 0.15 tolerance should pass
      expect(compareCountryBlend(expected, actual, 0.15)).toBe(true);
      // 0.1 difference with 0.05 tolerance should fail
      expect(compareCountryBlend(expected, actual, 0.05)).toBe(false);
    });

    it("fails when the primary and secondary country roles are swapped", () => {
      const expected = { indonesia: 0.75, japan: 0.25 };
      const actual = { indonesia: 0.25, japan: 0.75 };
      expect(compareCountryBlend(expected, actual, 0.15)).toBe(false);
    });

    it("fails when a country is omitted even if the remaining weight is close", () => {
      expect(compareCountryBlend({ indonesia: 0.75, japan: 0.25 }, { indonesia: 1 })).toBe(false);
    });
  });

  describe("compareAudience", () => {
    it("returns true when audience descriptions have significant term overlap", () => {
      const expected = "Young professionals interested in coffee";
      const actual = "Professionals interested in specialty coffee and modern lifestyle";
      expect(compareAudience(expected, actual)).toBe(true);
    });

    it("returns false when audience descriptions have minimal overlap", () => {
      const expected = "Young professionals interested in coffee";
      const actual = "Elderly retired farmers";
      expect(compareAudience(expected, actual)).toBe(false);
    });

    it("returns false when actual is undefined", () => {
      const expected = "Young professionals";
      expect(compareAudience(expected, undefined)).toBe(false);
    });

    it("returns false when actual is empty string", () => {
      const expected = "Young professionals";
      expect(compareAudience(expected, "")).toBe(false);
    });

    it("achieves 30% term overlap for single-word exact match", () => {
      const expected = "professionals young urban";
      const actual = "professionals"; // 1 of 3 = 33% > 30%
      expect(compareAudience(expected, actual)).toBe(true);
    });

    it("requires at least 30% term overlap", () => {
      const expected = "professionals young urban affluent";
      const actual = "student"; // 0 of 4 = 0% < 30%
      expect(compareAudience(expected, actual)).toBe(false);
    });

    it("is case-insensitive", () => {
      const expected = "Urban Professionals";
      const actual = "urban professionals in cities";
      expect(compareAudience(expected, actual)).toBe(true);
    });

    it("matches Indonesian audience aliases against English expectations", () => {
      expect(compareAudience("Young women and business owners", "perempuan muda pemilik bisnis")).toBe(true);
      expect(compareAudience("Young people who enjoy coffee", "anak muda yang suka kopi specialty")).toBe(true);
      expect(compareAudience("Young professionals", "profesional muda")).toBe(true);
    });

    it("matches Indonesian paraphrases without matching raw words", () => {
      expect(compareAudience("SME owners and business managers", "pemilik usaha dan manajer bisnis")).toBe(true);
    });
  });
});

describe("evaluate-briefs metrics calculation", () => {
  type TestEvaluation = {
    id: string;
    raw_brief: string;
    expected: Record<string, unknown>;
    call_succeeded: boolean;
    call_error?: string;
    field_comparisons: Array<{
      field: string;
      expected: string | number | Record<string, unknown> | null;
      actual: string | number | Record<string, unknown> | null;
      match: boolean;
      reason?: string;
    }>;
    completeness_score?: number;
    model_calls: number;
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
    was_repaired: boolean;
    readiness: {
      ready: boolean;
      blocking_fields: string[];
      missing_blocking_fields: string[];
      optional_missing_fields: string[];
      derived_fields: string[];
    };
    ready: boolean;
  };

  const createEvaluation = (overrides: Partial<TestEvaluation> = {}): TestEvaluation => ({
    id: "test-brief",
    raw_brief: "test",
    expected: {},
    call_succeeded: true,
    field_comparisons: [
      {
        field: "objective",
        expected: "launch",
        actual: "launch",
        match: true
      },
      {
        field: "industry_id",
        expected: "fnb",
        actual: "fnb",
        match: true
      }
    ],
    completeness_score: 0.8,
    model_calls: 1,
    input_tokens: 1000,
    output_tokens: 500,
    estimated_cost_usd: 0.001,
    was_repaired: false,
    readiness: {
      ready: true,
      blocking_fields: ["objective", "industry_id"],
      missing_blocking_fields: [],
      optional_missing_fields: ["core_message"],
      derived_fields: []
    },
    ready: true,
    ...overrides
  });

  it("calculates correct totals for successful calls", () => {
    const evaluations = [
      createEvaluation({ call_succeeded: true }),
      createEvaluation({ call_succeeded: true }),
      createEvaluation({ call_succeeded: false })
    ];

    const metrics = calculateMetrics(evaluations);

    expect(metrics.total).toBe(3);
    expect(metrics.successful).toBe(2);
    expect(metrics.failed).toBe(1);
  });

  it("calculates field accuracy correctly", () => {
    const evaluations = [
      createEvaluation({
        field_comparisons: [
          { field: "objective", expected: "launch", actual: "launch", match: true },
          { field: "industry_id", expected: "fnb", actual: "fashion", match: false }
        ]
      }),
      createEvaluation({
        field_comparisons: [
          { field: "objective", expected: "launch", actual: "launch", match: true },
          { field: "industry_id", expected: "fnb", actual: "fnb", match: true }
        ]
      })
    ];

    const metrics = calculateMetrics(evaluations);

    expect(metrics.field_accuracy["objective"]?.matches).toBe(2);
    expect(metrics.field_accuracy["objective"]?.total).toBe(2);
    expect(metrics.field_accuracy["industry_id"]?.matches).toBe(1);
    expect(metrics.field_accuracy["industry_id"]?.total).toBe(2);
  });

  it("reports eligible and readiness exclusion denominators", () => {
    const metrics = calculateMetrics([
      createEvaluation({ ready: true }),
      createEvaluation({ ready: false }),
      createEvaluation({ call_succeeded: false, ready: false })
    ]);

    expect(metrics.total).toBe(3);
    expect(metrics.eligible).toBe(1);
    expect(metrics.excluded).toBe(2);
    expect(metrics.readiness_exclusion_count).toBe(1);
    expect(metrics.readiness_exclusion_rate).toBeCloseTo(0.5);
  });

  it("excludes nullable expected fields from accuracy denominators", () => {
    const metrics = calculateMetrics([
      createEvaluation({
        field_comparisons: [
          { field: "audience", expected: null, actual: "anything", match: false }
        ]
      })
    ]);

    expect(metrics.field_accuracy.audience).toBeUndefined();
    expect(metrics.overall_field_accuracy).toBe(0);
  });

  it("calculates overall field accuracy as average of field accuracies", () => {
    const evaluations = [
      createEvaluation({
        field_comparisons: [
          { field: "field1", expected: "a", actual: "a", match: true },
          { field: "field2", expected: "b", actual: "b", match: true }
        ]
      }),
      createEvaluation({
        field_comparisons: [
          { field: "field1", expected: "a", actual: "x", match: false },
          { field: "field2", expected: "b", actual: "b", match: true }
        ]
      })
    ];

    const metrics = calculateMetrics(evaluations);

    // field1: 1/2 = 0.5
    // field2: 2/2 = 1.0
    // overall: (0.5 + 1.0) / 2 = 0.75
    expect(metrics.overall_field_accuracy).toBeCloseTo(0.75);
  });

  it("calculates average completeness score from successful evaluations", () => {
    const evaluations = [
      createEvaluation({ call_succeeded: true, completeness_score: 0.8 }),
      createEvaluation({ call_succeeded: true, completeness_score: 0.9 }),
      createEvaluation({ call_succeeded: false })
    ];

    const metrics = calculateMetrics(evaluations);

    // Only successful evaluations: (0.8 + 0.9) / 2 = 0.85
    expect(metrics.average_completeness_score).toBeCloseTo(0.85);
  });

  it("calculates average tokens correctly", () => {
    const evaluations = [
      createEvaluation({ call_succeeded: true, input_tokens: 1000, output_tokens: 500 }),
      createEvaluation({ call_succeeded: true, input_tokens: 1200, output_tokens: 600 }),
      createEvaluation({ call_succeeded: false, input_tokens: 0, output_tokens: 0 })
    ];

    const metrics = calculateMetrics(evaluations);

    // Only successful evaluations: (1000 + 1200) / 2 = 1100
    expect(metrics.average_input_tokens).toBeCloseTo(1100);
    // (500 + 600) / 2 = 550
    expect(metrics.average_output_tokens).toBeCloseTo(550);
  });

  it("calculates average cost correctly", () => {
    const evaluations = [
      createEvaluation({ call_succeeded: true, estimated_cost_usd: 0.001 }),
      createEvaluation({ call_succeeded: true, estimated_cost_usd: 0.003 }),
      createEvaluation({ call_succeeded: false })
    ];

    const metrics = calculateMetrics(evaluations);

    // Only successful: (0.001 + 0.003) / 2 = 0.002
    expect(metrics.average_cost_usd).toBeCloseTo(0.002);
  });

  it("counts repaired briefs", () => {
    const evaluations = [
      createEvaluation({ was_repaired: true }),
      createEvaluation({ was_repaired: false }),
      createEvaluation({ was_repaired: true })
    ];

    const metrics = calculateMetrics(evaluations);

    expect(metrics.repaired_count).toBe(2);
  });

  it("counts ready and not-ready briefs", () => {
    const evaluations = [
      createEvaluation({ ready: true }),
      createEvaluation({ ready: false }),
      createEvaluation({ ready: true })
    ];

    const metrics = calculateMetrics(evaluations);

    expect(metrics.ready_count).toBe(2);
    expect(metrics.not_ready_count).toBe(1);
  });

  it("handles empty evaluation set", () => {
    const metrics = calculateMetrics([]);

    expect(metrics.total).toBe(0);
    expect(metrics.successful).toBe(0);
    expect(metrics.failed).toBe(0);
    expect(metrics.overall_field_accuracy).toBe(0);
    expect(metrics.average_completeness_score).toBe(0);
  });

  it("reports correct structure for metrics", () => {
    const evaluations = [createEvaluation()];
    const metrics = calculateMetrics(evaluations);

    expect(metrics).toHaveProperty("total");
    expect(metrics).toHaveProperty("successful");
    expect(metrics).toHaveProperty("failed");
    expect(metrics).toHaveProperty("field_accuracy");
    expect(metrics).toHaveProperty("overall_field_accuracy");
    expect(metrics).toHaveProperty("average_completeness_score");
    expect(metrics).toHaveProperty("average_input_tokens");
    expect(metrics).toHaveProperty("average_output_tokens");
    expect(metrics).toHaveProperty("average_cost_usd");
    expect(metrics).toHaveProperty("repaired_count");
    expect(metrics).toHaveProperty("ready_count");
    expect(metrics).toHaveProperty("not_ready_count");
  });

  it("counts fields excluded by readiness separately from eligible evaluations", () => {
    const metrics = calculateMetrics([
      createEvaluation({ ready: true, expected: { objective: "launch" } }),
      createEvaluation({ ready: false, expected: { objective: "launch" }, readiness: {
        ready: false,
        blocking_fields: ["objective", "industry_id"],
        missing_blocking_fields: ["objective"],
        optional_missing_fields: ["core_message"],
        derived_fields: []
      } })
    ]);

    expect(metrics.field_accuracy.objective).toEqual({
      matches: 1,
      total: 1,
      not_evaluated_due_to_readiness: 1
    });
  });

  it("builds an excluded brief report without persisting prompts or API keys", () => {
    const evaluation = createEvaluation({
      ready: false,
      raw_brief: "client brief",
      readiness: {
        ready: false,
        blocking_fields: ["objective"],
        missing_blocking_fields: ["objective"],
        optional_missing_fields: ["core_message"],
        derived_fields: []
      }
    });
    const report = buildEvaluationReport([evaluation], calculateMetrics([evaluation]), 0);
    const serialized = JSON.stringify(report);
    expect(report.briefs[0]).toMatchObject({
      raw_brief: "client brief",
      ready: false,
      readiness: { missing_blocking_fields: ["objective"] },
      field_comparisons: evaluation.field_comparisons
    });
    expect(serialized).not.toContain("GEMINI_API_KEY");
    expect(serialized).not.toContain("Extract structured data from the client brief");
  });
});
