/**
 * Real Brief Evaluation Harness — P2.3.2
 *
 * Runs 10 realistic Indonesian briefs through the REAL Gemini Brief Interpreter
 * and produces structured evaluation report.
 *
 * This is an engineering evaluation tool, NOT a statistically representative benchmark.
 */

import { join } from "node:path";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import type { NormalizedBrief } from "../types";
import type { BriefExtraction } from "../engine/brief/extraction";
import {
  BLOCKING_FIELDS,
  getReadinessDiagnostics,
  type ReadinessDiagnostics
} from "../engine/brief/completeness";
import { loadDatasets } from "../data/loader";
import { createGeminiLlm, DEFAULT_GEMINI_MODEL } from "../adapters/llm/gemini";
import { systemClock } from "../ports/clock.port";
import { sequentialIds } from "../ports/id.port";
import { normalizeBrief } from "../engine/brief/normalize";
import { createCostLedger, estimateCostUsd } from "../services/cost.service";

/** Load local development variables without ever logging their contents. */
function loadLocalEnv(envPath = join(process.cwd(), ".env.local")): void {
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function requireGeminiApiKey(
  environment: { readonly GEMINI_API_KEY?: string } | NodeJS.ProcessEnv = process.env
): string {
  const apiKey = environment.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
  return apiKey;
}

/** Load the 10 evaluation briefs. */
function loadBriefs(): Array<{
  id: string;
  brief: string;
  expected: {
    objective: string | null;
    industry_id: string | null;
    visual_type_id: string | null;
    country: Record<string, number> | null;
    platform: { channel: string | null; aspect_ratio_id: string | null };
    audience: string | null;
  };
}> {
  const briefsPath = join(process.cwd(), "data/evaluation/real-briefs.json");
  const content = readFileSync(briefsPath, "utf-8");
  const briefs = JSON.parse(content);
  return briefs;
}

type FieldComparison = {
  field: string;
  expected: string | number | Record<string, unknown> | null;
  actual: string | number | Record<string, unknown> | null;
  match: boolean;
  reason?: string;
};

type BriefEvaluation = {
  id: string;
  raw_brief: string;
  expected: Record<string, unknown>;
  call_succeeded: boolean;
  call_error?: string;
  actual_normalized?: NormalizedBrief | null;
  raw_extraction?: BriefExtraction | null;
  readiness: ReadinessDiagnostics;
  field_comparisons: FieldComparison[];
  completeness_score?: number;
  confidence_summary?: Record<string, number>;
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  was_repaired: boolean;
  ready: boolean;
};

export type EvaluationFieldMetric = { matches: number; total: number; not_evaluated_due_to_readiness: number };

export const EVALUATED_FIELDS = [
  "objective",
  "industry_id",
  "visual_type_id",
  "country",
  "platform.channel",
  "platform.aspect_ratio_id",
  "audience"
] as const;

export function compareCountryBlend(
  expected: Record<string, number>,
  actual: Record<string, number> | undefined,
  tolerance = 0.15
): boolean {
  if (!actual) return false;

  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (actualKeys.length === 0 || expectedKeys.join("\0") !== actualKeys.join("\0")) return false;

  const primary = (blend: Record<string, number>): string | undefined =>
    Object.entries(blend).sort(([, left], [, right]) => right - left)[0]?.[0];
  if (primary(expected) !== primary(actual)) return false;

  return expectedKeys.every((key) => Math.abs(expected[key]! - (actual[key] ?? 0)) <= tolerance);
}

export function compareAudience(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;

  const aliases: Array<[RegExp, string]> = [
    [/\b(anak muda|remaja|generasi muda|young people|youth|millennial|gen ?z|teenagers?)\b/g, "youth"],
    [/\b(perempuan muda|wanita muda|young women)\b/g, "young-women"],
    [/\b(perempuan|wanita|women|female)\b/g, "women"],
    [/\b(laki-laki|pria|men|male)\b/g, "men"],
    [/\b(pemilik bisnis|pemilik usaha|business owners?|sme owners?|entrepreneurs?)\b/g, "business-owners"],
    [/\b(profesional muda|professional muda|young professionals?)\b/g, "young-professionals"],
    [/\b(profesional|professionals?|manager|managers?)\b/g, "professionals"],
    [/\b(keluarga muda|young families)\b/g, "young-families"],
    [/\b(urban|perkotaan|kota)\b/g, "urban"],
    [/\b(pelajar|mahasiswa|students?)\b/g, "students"],
    [/\b(affluent|high[- ]income|high[- ]end|menengah ke atas|middle to upper)\b/g, "affluent"],
    [/\b(kopi|coffee)\b/g, "coffee"],
    [/\b(skincare|perawatan kulit|natural beauty)\b/g, "skincare"],
    [/\b(fitness|kebugaran|wellness|kesehatan)\b/g, "fitness"],
    [/\b(designers?|design professionals?|creatives?|kreatif)\b/g, "design"],
    [/\b(business intelligence|digital transformation|transformasi digital)\b/g, "business-technology"]
  ];

  const normalise = (value: string): Set<string> => {
    let text = value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
    const categories = new Set<string>();
    for (const [pattern, category] of aliases) {
      if (pattern.test(text)) categories.add(category);
      text = text.replace(pattern, " ");
      pattern.lastIndex = 0;
    }
    const stopWords = new Set(["and", "the", "yang", "dan", "with", "aged", "usia", "interested", "tertarik"]);
    for (const token of text.split(/\s+/).filter((item) => item.length > 2)) {
      if (!stopWords.has(token)) categories.add(token.replace(/s$/, ""));
    }
    const age = value.match(/\b(\d{2})\s*[-–]\s*(\d{2})\b/);
    if (age) categories.add(`age-${Math.floor(Number(age[1]) / 10) * 10}`);
    return categories;
  };

  const expectedCategories = normalise(expected);
  const actualCategories = normalise(actual);
  if (expectedCategories.size === 0 || actualCategories.size === 0) return false;
  const matches = [...expectedCategories].filter((category) => actualCategories.has(category));
  return matches.length / expectedCategories.size >= 0.3;
}

function evaluateBrief(
  rawBrief: string,
  expected: BriefEvaluation["expected"],
  outcome: Awaited<ReturnType<typeof normalizeBrief>>,
  meta: { modelCalls: number; inputTokens: number; outputTokens: number; wasRepaired: boolean }
): BriefEvaluation {
  const comparisons: FieldComparison[] = [];

  if (!outcome.ok) {
    return {
      id: "",
      raw_brief: rawBrief,
      expected,
      call_succeeded: false,
      call_error: outcome.error?.[0]?.message || "Unknown error",
      raw_extraction: null,
      readiness: {
        ready: false,
        blocking_fields: [...BLOCKING_FIELDS],
        missing_blocking_fields: [],
        optional_missing_fields: [],
        derived_fields: []
      },
      field_comparisons: comparisons,
      model_calls: meta.modelCalls,
      input_tokens: meta.inputTokens,
      output_tokens: meta.outputTokens,
      estimated_cost_usd: estimateCostUsd(DEFAULT_GEMINI_MODEL, meta.inputTokens, meta.outputTokens),
      was_repaired: meta.wasRepaired,
      ready: false
    };
  }

  const actual = outcome.value.brief;
  const completeness = outcome.value.completeness;
  const expectedRecord = expected as Record<string, unknown>;
  const addComparison = (
    field: string,
    expectedValue: FieldComparison["expected"],
    actualValue: FieldComparison["actual"],
    match: boolean,
    reason?: string
  ): void => {
    if (expectedValue === null || expectedValue === undefined) return;
    comparisons.push({ field, expected: expectedValue, actual: actualValue, match, reason });
  };

  if (!actual) {
    return {
      id: "",
      raw_brief: rawBrief,
      expected,
      call_succeeded: true,
      actual_normalized: null,
      raw_extraction: outcome.value.extraction,
      readiness: getReadinessDiagnostics(completeness, outcome.value.derived),
      field_comparisons: comparisons,
      completeness_score: completeness.completeness_score,
      model_calls: meta.modelCalls,
      input_tokens: meta.inputTokens,
      output_tokens: meta.outputTokens,
      estimated_cost_usd: estimateCostUsd(DEFAULT_GEMINI_MODEL, meta.inputTokens, meta.outputTokens),
      was_repaired: meta.wasRepaired,
      ready: false
    };
  }

  // Compare objective
  addComparison("objective", expectedRecord.objective as string | null, actual.objective,
    actual.objective === expectedRecord.objective);

  // Compare industry
  addComparison("industry_id", expectedRecord.industry_id as string | null, actual.industry_id,
    actual.industry_id === expectedRecord.industry_id);

  // Compare visual type
  addComparison("visual_type_id", expectedRecord.visual_type_id as string | null, actual.visual_type_id,
    actual.visual_type_id === expectedRecord.visual_type_id);

  // Compare country blend with tolerance
  const expectedCountry = expectedRecord.country as Record<string, number> | null;
  if (expectedCountry !== null && expectedCountry !== undefined) {
    addComparison("country", JSON.stringify(expectedCountry), JSON.stringify(actual.country),
      compareCountryBlend(expectedCountry, actual.country as Record<string, number>));
  }

  // Compare platform channel
  const expectedPlatform = (expected as Record<string, unknown>).platform as Record<string, unknown>;
  addComparison("platform.channel", expectedPlatform?.channel as string | null, actual.platform.channel,
    actual.platform.channel === expectedPlatform?.channel);

  // Compare aspect ratio
  addComparison("platform.aspect_ratio_id", expectedPlatform?.aspect_ratio_id as string | null,
    actual.platform.aspect_ratio_id, actual.platform.aspect_ratio_id === expectedPlatform?.aspect_ratio_id);

  // Compare audience (semantic comparison)
  const expectedAudience = expectedRecord.audience as string | null;
  if (expectedAudience !== null && expectedAudience !== undefined) {
    addComparison("audience", expectedAudience, actual.audience.description,
      compareAudience(expectedAudience, actual.audience.description),
      "Deterministic language-aware category comparison with 30% expected-category overlap");
  }

  return {
    id: "",
    raw_brief: rawBrief,
    expected,
    call_succeeded: true,
    actual_normalized: actual,
    raw_extraction: outcome.value.extraction,
    readiness: getReadinessDiagnostics(completeness, outcome.value.derived),
    field_comparisons: comparisons,
    completeness_score: completeness.completeness_score,
    confidence_summary: actual.confidence,
    model_calls: meta.modelCalls,
    input_tokens: meta.inputTokens,
    output_tokens: meta.outputTokens,
    estimated_cost_usd: estimateCostUsd(DEFAULT_GEMINI_MODEL, meta.inputTokens, meta.outputTokens),
    was_repaired: meta.wasRepaired,
    ready: completeness.ready
  };
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(6)}`;
}

function printBriefResult(briefNumber: number, briefId: string, eval_: BriefEvaluation): void {
  console.log(`\n────────────────────────────`);
  console.log(`[${String(briefNumber).padStart(2, "0")}] ${briefId}`);

  if (!eval_.call_succeeded) {
    console.log(`CALL: FAILED`);
    console.log(`  Error: ${eval_.call_error}`);
  } else {
    console.log(`CALL: SUCCESS`);
    console.log(`READY: ${eval_.ready ? "YES" : "NO"}`);
    if (!eval_.ready) {
      console.log(`\nMissing blocking fields:`);
      for (const field of eval_.readiness.missing_blocking_fields) console.log(`- ${field}`);
    }
    console.log(`\nOptional missing:`);
    for (const field of eval_.readiness.optional_missing_fields) console.log(`- ${field}`);

    for (const comp of eval_.field_comparisons) {
      const symbol = comp.match ? "✓" : "✗";
      console.log(`${symbol} ${comp.field}`);
      if (!comp.match) {
        console.log(`  Expected: ${JSON.stringify(comp.expected)}`);
        console.log(`  Actual:   ${JSON.stringify(comp.actual)}`);
        if (comp.reason) console.log(`  Note: ${comp.reason}`);
      }
    }
  }

  if (eval_.completeness_score !== undefined) {
    console.log(`\nCompleteness: ${eval_.completeness_score.toFixed(4)}`);
  }
  console.log(`Calls: ${eval_.model_calls}`);
  console.log(`Input tokens: ${eval_.input_tokens}`);
  console.log(`Output tokens: ${eval_.output_tokens}`);
  console.log(`Cost: ${formatCost(eval_.estimated_cost_usd)}`);

  if (eval_.was_repaired) {
    console.log(`⚠ Required repair`);
  }
}

export type Metrics = {
  total: number;
  eligible: number;
  excluded: number;
  successful: number;
  failed: number;
  field_accuracy: Record<string, EvaluationFieldMetric>;
  overall_field_accuracy: number;
  average_completeness_score: number;
  average_input_tokens: number;
  average_output_tokens: number;
  average_cost_usd: number;
  repaired_count: number;
  ready_count: number;
  not_ready_count: number;
  readiness_exclusion_count: number;
  readiness_exclusion_rate: number;
};

export function calculateMetrics(evaluations: BriefEvaluation[]): Metrics {
  const successful = evaluations.filter((e) => e.call_succeeded).length;
  const failed = evaluations.filter((e) => !e.call_succeeded).length;

  const fieldAccuracy: Record<string, EvaluationFieldMetric> = {};
  const ensureField = (field: string): EvaluationFieldMetric => {
    fieldAccuracy[field] ??= { matches: 0, total: 0, not_evaluated_due_to_readiness: 0 };
    return fieldAccuracy[field]!;
  };
  for (const eval_ of evaluations) {
    for (const field of EVALUATED_FIELDS) {
      const expected = field === "platform.channel" || field === "platform.aspect_ratio_id"
        ? (eval_.expected.platform as Record<string, unknown> | undefined)?.[field.replace("platform.", "")]
        : eval_.expected[field];
      if (expected !== null && expected !== undefined && eval_.call_succeeded && !eval_.ready) {
        ensureField(field).not_evaluated_due_to_readiness += 1;
      }
    }
    if (!eval_.ready) continue;
    for (const comp of eval_.field_comparisons) {
      if (comp.expected === null || comp.expected === undefined) continue;
      const acc = ensureField(comp.field);
      acc.total += 1;
      if (comp.match) acc.matches += 1;
    }
  }

  const fieldAccuracies = Object.values(fieldAccuracy)
    .filter((field) => field.total > 0)
    .map((field) => field.matches / field.total);
  const overallFieldAccuracy =
    fieldAccuracies.length > 0 ? fieldAccuracies.reduce((a, b) => a + b, 0) / fieldAccuracies.length : 0;

  const successfulEvals = evaluations.filter((e) => e.call_succeeded);
  const avgCompleteness =
    successfulEvals.length > 0
      ? successfulEvals.reduce((sum, e) => sum + (e.completeness_score ?? 0), 0) / successfulEvals.length
      : 0;

  const avgInputTokens =
    successful > 0 ? evaluations.reduce((sum, e) => sum + e.input_tokens, 0) / successful : 0;
  const avgOutputTokens =
    successful > 0 ? evaluations.reduce((sum, e) => sum + e.output_tokens, 0) / successful : 0;
  const avgCost =
    successful > 0 ? evaluations.reduce((sum, e) => sum + e.estimated_cost_usd, 0) / successful : 0;

  const repaired = evaluations.filter((e) => e.was_repaired).length;
  const ready = evaluations.filter((e) => e.ready).length;
  const notReady = evaluations.filter((e) => !e.ready).length;
  const eligible = evaluations.filter((e) => e.call_succeeded && e.ready).length;
  const readinessExclusions = evaluations.filter((e) => e.call_succeeded && !e.ready).length;

  return {
    total: evaluations.length,
    eligible,
    excluded: evaluations.length - eligible,
    successful,
    failed,
    field_accuracy: fieldAccuracy,
    overall_field_accuracy: overallFieldAccuracy,
    average_completeness_score: avgCompleteness,
    average_input_tokens: avgInputTokens,
    average_output_tokens: avgOutputTokens,
    average_cost_usd: avgCost,
    repaired_count: repaired,
    ready_count: ready,
    not_ready_count: notReady,
    readiness_exclusion_count: readinessExclusions,
    readiness_exclusion_rate: successful > 0 ? readinessExclusions / successful : 0
  };
}

export function buildEvaluationReport(evaluations: BriefEvaluation[], metrics: Metrics, totalCost: number) {
  return {
    total_briefs: metrics.total,
    eligible_briefs: metrics.eligible,
    excluded_briefs: metrics.excluded,
    total: metrics.total,
    eligible: metrics.eligible,
    excluded: metrics.excluded,
    successful: metrics.successful,
    failed: metrics.failed,
    metrics: {
      field_accuracy: metrics.field_accuracy,
      overall_field_accuracy: metrics.overall_field_accuracy,
      average_completeness_score: metrics.average_completeness_score,
      average_input_tokens: metrics.average_input_tokens,
      average_output_tokens: metrics.average_output_tokens,
      average_cost_usd: metrics.average_cost_usd,
      total_cost_usd: totalCost,
      repaired_count: metrics.repaired_count,
      ready_count: metrics.ready_count,
      not_ready_count: metrics.not_ready_count,
      readiness_exclusion_count: metrics.readiness_exclusion_count,
      readiness_exclusion_rate: metrics.readiness_exclusion_rate
    },
    briefs: evaluations.map((evaluation) => ({
      id: evaluation.id,
      raw_brief: evaluation.raw_brief,
      raw_extraction: evaluation.raw_extraction ?? null,
      normalized_brief: evaluation.actual_normalized ?? null,
      expected: evaluation.expected,
      call_succeeded: evaluation.call_succeeded,
      errors: evaluation.call_error ? [evaluation.call_error] : [],
      readiness: evaluation.readiness,
      ready: evaluation.ready,
      completeness_score: evaluation.completeness_score ?? null,
      confidence_summary: evaluation.confidence_summary ?? {},
      field_comparisons: evaluation.field_comparisons,
      model_calls: evaluation.model_calls,
      input_tokens: evaluation.input_tokens,
      output_tokens: evaluation.output_tokens,
      estimated_cost_usd: evaluation.estimated_cost_usd,
      was_repaired: evaluation.was_repaired
    }))
  };
}

async function runEvaluation(): Promise<void> {
  console.log("\n════════════════════════════════════════════════════════");
  console.log("ANDALA AI — REAL BRIEF EVALUATION");
  console.log("════════════════════════════════════════════════════════\n");

  loadLocalEnv();
  const apiKey = requireGeminiApiKey();

  const clock = systemClock;
  const ledger = createCostLedger({
    clock,
    maxCallsPerProject: 20 // Safety cap: 10 briefs × 2 attempts max
  });

  const llm = createGeminiLlm({
    apiKey,
    clock,
    ledger,
    maxAttempts: 2
  });

  const datasets = loadDatasets();
  const briefs = loadBriefs();
  const ids = sequentialIds();

  console.log(`Model: ${DEFAULT_GEMINI_MODEL}`);
  console.log(`Briefs: ${briefs.length}\n`);

  const evaluations: BriefEvaluation[] = [];

  for (let i = 0; i < briefs.length; i++) {
    const briefData = briefs[i];
    if (!briefData) continue;
    const projectId = `evaluation_${briefData.id}`;

    let callCount = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let wasRepaired = false;

    try {
      const outcome = await normalizeBrief({
        rawBrief: briefData.brief,
        projectId,
        datasets,
        llm,
        ids
      });

      const events = ledger.list(projectId);
      callCount = events.length;
      for (const event of events) {
        inputTokens += event.input_tokens;
        outputTokens += event.output_tokens;
        wasRepaired = wasRepaired || event.attempt > 1;
      }

      const evaluation = evaluateBrief(
        briefData.brief,
        briefData.expected,
        outcome,
        {
          modelCalls: callCount,
          inputTokens,
          outputTokens,
          wasRepaired
        }
      );
      evaluation.id = briefData.id;
      evaluations.push(evaluation);

      printBriefResult(i + 1, briefData.id, evaluation);
    } catch (error) {
      const evaluation: BriefEvaluation = {
        id: briefData.id,
        raw_brief: briefData.brief,
        expected: briefData.expected,
        call_succeeded: false,
        call_error: error instanceof Error ? error.message : "Unknown error",
        field_comparisons: [],
        model_calls: 0,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        was_repaired: false,
        readiness: {
          ready: false,
          blocking_fields: [...BLOCKING_FIELDS],
          missing_blocking_fields: [],
          optional_missing_fields: [],
          derived_fields: []
        },
        ready: false
      };
      evaluations.push(evaluation);

      printBriefResult(i + 1, briefData.id, evaluation);
    }
  }

  // Print summary metrics
  console.log("\n════════════════════════════════════════════════════════");
  console.log("SUMMARY");
  console.log("════════════════════════════════════════════════════════\n");

  const metrics = calculateMetrics(evaluations);

  console.log(`Total briefs: ${metrics.total}`);
  console.log(`Eligible briefs: ${metrics.eligible}`);
  console.log(`Excluded briefs: ${metrics.excluded}`);
  console.log(`Successful calls: ${metrics.successful}`);
  console.log(`Failed calls: ${metrics.failed}`);
  console.log(`Ready for design: ${metrics.ready_count}`);
  console.log(`Not ready: ${metrics.not_ready_count}`);
  console.log(
    `Readiness exclusions: ${metrics.readiness_exclusion_count} (${(metrics.readiness_exclusion_rate * 100).toFixed(1)}% of successful calls)`
  );
  console.log(`Requiring repair: ${metrics.repaired_count}\n`);

  console.log("Field accuracy:");
  for (const [field, acc] of Object.entries(metrics.field_accuracy)) {
    const accuracy = (acc.matches / acc.total) * 100;
    console.log(
      `  ${field}: ${accuracy.toFixed(1)}% (${acc.matches}/${acc.total} eligible, ${acc.not_evaluated_due_to_readiness} excluded)`
    );
  }
  console.log(`  Overall: ${(metrics.overall_field_accuracy * 100).toFixed(1)}%\n`);

  console.log("Averages:");
  console.log(`  Completeness score: ${metrics.average_completeness_score.toFixed(4)}`);
  console.log(`  Input tokens: ${metrics.average_input_tokens.toFixed(1)}`);
  console.log(`  Output tokens: ${metrics.average_output_tokens.toFixed(1)}`);
  console.log(`  Cost per brief: ${formatCost(metrics.average_cost_usd)}`);

  const totalCost = evaluations.reduce((sum, e) => sum + e.estimated_cost_usd, 0);
  console.log(`  Total cost: ${formatCost(totalCost)}\n`);

  // Write machine-readable report
  const reportPath = join(process.cwd(), "reports/real-brief-evaluation.json");
  const report = {
    run_at: new Date().toISOString(),
    model: DEFAULT_GEMINI_MODEL,
    pricing_as_of: "2026-09-04",
    ...buildEvaluationReport(evaluations, metrics, totalCost)
  };

  // Create reports directory if needed
  const reportsDir = join(process.cwd(), "reports");
  try {
    mkdirSync(reportsDir, { recursive: true });
  } catch {
    // Ignore
  }

  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report written: ${reportPath}`);
  console.log(`\n════════════════════════════════════════════════════════\n`);
}

runEvaluation().catch((error) => {
  console.error("Evaluation failed:", error);
  process.exit(1);
});
