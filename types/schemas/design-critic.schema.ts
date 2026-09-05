import { z } from "zod";
import { Id, NonEmptyText, Note } from "../primitives";

/**
 * The Design Critic report — P4.0.
 *
 * A DERIVED, read-only verdict on a finished `contract → direction → recipe →
 * PromptSet`. It runs no model, touches no image, makes no network call and
 * mutates nothing. Every finding is a deterministic function of values the
 * pipeline already resolved (DKV derivations and conflicts, movement influence,
 * artificiality risk, immutable anchors, the compiled prompt strings, the
 * stereotype output guard). See `docs/design-critic.md`.
 *
 * Internally each finding carries the pipeline's own P0 / P1 / P2 severity so a
 * reviewer can trace it back. The report as a whole exposes only a three-state
 * verdict:
 *
 *   PASS   — no significant design-quality issue found.
 *   REVIEW — a meaningful issue or tension exists; the recipe may still proceed
 *            with human review.
 *   BLOCK  — a critical violation makes the recipe unsuitable to proceed.
 */

export const CriticVerdict = z.enum(["PASS", "REVIEW", "BLOCK"]);
export type CriticVerdict = z.infer<typeof CriticVerdict>;

/** The pipeline's existing conflict-severity scale, reused unchanged. */
export const CriticSeverity = z.enum(["P0", "P1", "P2"]);
export type CriticSeverity = z.infer<typeof CriticSeverity>;

/** Which part of the pipeline a finding is about. */
export const CriticArea = z.enum([
  "integrity",
  "dkv",
  "movement",
  "photographic",
  "prompt-coverage",
  "stereotype-guard",
  "concept"
]);
export type CriticArea = z.infer<typeof CriticArea>;

export const CriticFinding = z.object({
  /** Stable slug for the check that produced this, e.g. "dkv-conflict". */
  check: NonEmptyText,
  area: CriticArea,
  /**
   * P0 ⇒ contributes BLOCK, P1 ⇒ contributes REVIEW, P2 ⇒ informational only
   * (listed, never changes the verdict).
   */
  severity: CriticSeverity,
  message: Note,
  /** Concrete values behind the finding — param names, requested/resolved, fragments. */
  evidence: z.array(NonEmptyText)
});
export type CriticFinding = z.infer<typeof CriticFinding>;

export const DesignCriticReport = z.object({
  verdict: CriticVerdict,
  /** One deterministic plain-language line. */
  summary: Note,
  /** How many checks ran (not how many findings). */
  checks_run: z.number().int().min(1),
  /** Most severe first, then by check slug. */
  findings: z.array(CriticFinding),
  /** What was audited — for traceability, never re-derived. */
  audited: z.object({
    contract_id: Id,
    direction_id: Id,
    recipe_id: Id,
    recipe_hash: z.string().length(8),
    prompt_language: NonEmptyText,
    concept_ref: Id.nullable()
  })
});
export type DesignCriticReport = z.infer<typeof DesignCriticReport>;
