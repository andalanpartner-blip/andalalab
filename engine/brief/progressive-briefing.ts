import type { NormalizedBrief } from "../../types";
import type { BriefExtraction } from "./extraction";
import type { ClassificationDiagnostic } from "./classify";
import type { LlmIssue } from "../../ports/llm.port";
import { err, ok, type Result } from "../util/result";
import type { NormalizeBriefInput, BriefNormalizationOutcome } from "./normalize";
import { normalizeBrief } from "./normalize";
import type { ReadinessResult } from "./readiness";

/**
 * Progressive Briefing Layer
 *
 * Implements the three-state readiness model from docs/readiness-policy.md:
 *
 * RAW BRIEF → INTERPRET → SAFE INFERENCE → READINESS CHECK
 *   ├─ READY → design direction
 *   └─ NEEDS_CLARIFICATION → ask questions → user answer → re-normalize → READY
 *
 * This layer is a thin wrapper around normalizeBrief. It does not evaluate
 * readiness itself — normalizeBrief already calls evaluateReadiness and gates
 * `brief` on its verdict, so this function simply forwards that result and
 * adds the clarification-formatting helpers below. There is exactly one
 * readiness evaluation per call, not two.
 */

export type BriefReadinessOutcome = {
  readonly extraction: BriefExtraction;
  /** How `industry_id` / `audience.description` were resolved. Diagnostics only. */
  readonly classifications: readonly ClassificationDiagnostic[];
  readonly readiness: ReadinessResult;
  readonly brief: NormalizedBrief | null;
  readonly warnings: readonly string[];
  readonly derived: readonly string[];
  readonly meta: BriefNormalizationOutcome["meta"];
};

export type ProgressiveBriefingInput = NormalizeBriefInput;

/**
 * Normalize a brief and evaluate its readiness.
 *
 * Returns:
 * - A READY outcome with a NormalizedBrief
 * - A NEEDS_CLARIFICATION outcome with clarification questions
 * - An INVALID outcome with an error message
 *
 * After the user answers clarification questions, append their response to
 * the rawBrief string and call this function again. The normalizer will
 * re-interpret with both the original brief and the user's answer.
 */
export async function progressiveBriefing(
  input: ProgressiveBriefingInput
): Promise<Result<BriefReadinessOutcome, LlmIssue[]>> {
  const normalizationResult = await normalizeBrief(input);
  if (!normalizationResult.ok) {
    return err(normalizationResult.error);
  }

  // normalizeBrief already ran evaluateReadiness and gated `brief` on it —
  // outcome.brief is non-null iff outcome.readiness.status === "READY".
  // There is nothing left to decide here.
  const outcome = normalizationResult.value;

  return ok({
    extraction: outcome.extraction,
    classifications: outcome.classifications,
    readiness: outcome.readiness,
    brief: outcome.brief,
    warnings: outcome.warnings,
    derived: outcome.derived,
    meta: outcome.meta
  });
}

/**
 * Generate a client-facing clarification response.
 *
 * Takes a NEEDS_CLARIFICATION readiness result and formats it for the UI:
 * - Repeats back what was understood
 * - Lists the questions
 * - Instructs the user how to respond
 */
export function formatClarificationRequest(readiness: ReadinessResult): string {
  if (readiness.status !== "NEEDS_CLARIFICATION" || readiness.questions.length === 0) {
    return "";
  }

  const questionLines = readiness.questions
    .map((q, i) => `${i + 1}. ${q.question}`)
    .join("\n");

  return `Kami butuh beberapa klarifikasi sebelum lanjut:\n\n${questionLines}`;
}

/**
 * Construct a new raw brief by appending user answers to the original.
 *
 * Format: append user answers as a natural continuation of the brief.
 * Example:
 *   Original: "Buat poster grand opening coffee shop..."
 *   Answer: "Instagram Feed"
 *   Result: "Buat poster grand opening coffee shop... Materi di Instagram Feed."
 */
export function appendClarificationAnswers(
  originalBrief: string,
  answers: Record<string, string>
): string {
  const answerLines = Object.entries(answers)
    .map(([, value]) => value)
    .filter((v) => v && v.trim().length > 0)
    .map((v) => v.trim());

  if (answerLines.length === 0) {
    return originalBrief;
  }

  return originalBrief + "\n\n" + answerLines.join("\n");
}
