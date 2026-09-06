import { z } from "zod";
import { DatasetVersion, Id, IsoDate, NonEmptyText, Note, SemVer } from "../primitives";

/**
 * Creative Decision — P2.18.
 *
 * The immutable, provenance-bound record of a human's explicit decision about
 * ONE exact generated visual. It is the artifact that draws the line the
 * product principle demands:
 *
 *   AI critiques → AI recommends → **HUMAN DECIDES** → the decision is the
 *   FINAL word on this visual.
 *
 * A decision is NEVER mutated. A person changing their mind produces a NEW
 * decision that references the same subject; the earlier decisions stay exactly
 * as they were.
 *
 * `action`:
 *   - `approved`          — this visual is the creative outcome. Unlocks Final.
 *   - `needs_correction`  — the human selected bounded correction options (from
 *                           an existing CorrectionRecommendation) to apply.
 *   - `regenerate`        — the human wants a fresh render. Creating this
 *                           decision does NOT call the image provider —
 *                           regeneration stays a separate explicit action.
 *
 * `rejected` is deliberately NOT modelled: nothing in the workflow consumes a
 * terminal "no" distinct from `needs_correction` / `regenerate` / simply not
 * approving, and adding it would imply a disposal path the product does not
 * have.
 */

const Hash8 = z.string().length(8);

export const DecisionAction = z.enum(["approved", "needs_correction", "regenerate"]);
export type DecisionAction = z.infer<typeof DecisionAction>;

/**
 * The smallest actor representation. Until P2.20 introduces real authentication
 * this is a documented temporary stand-in (`role: "creative"` / a fixed local
 * id) — it is NOT an authentication system and grants nothing.
 */
export const DecisionActor = z
  .object({
    id: NonEmptyText,
    role: NonEmptyText,
    display_name: NonEmptyText
  })
  .strict();
export type DecisionActor = z.infer<typeof DecisionActor>;

/** The EXACT visual this decision is about. Every hash copied from an artifact. */
export const DecisionSubject = z
  .object({
    generated_artifact_id: Id,
    artifact_hash: Hash8,
    recipe_id: Id,
    recipe_hash: Hash8,
    blueprint_id: Id.nullable(),
    blueprint_hash: Hash8.nullable(),
    prompt_hash: Hash8,
    generation_request_hash: Hash8
  })
  .strict();
export type DecisionSubject = z.infer<typeof DecisionSubject>;

/** The upstream reasoning artifacts that existed when the decision was made. */
export const DecisionContext = z
  .object({
    evidence_id: Id.nullable(),
    evidence_hash: Hash8.nullable(),
    critique_id: Id.nullable(),
    critique_hash: Hash8.nullable(),
    recommendation_id: Id.nullable(),
    recommendation_hash: Hash8.nullable(),
    correction_cycle_id: Id.nullable(),
    correction_cycle_hash: Hash8.nullable()
  })
  .strict();
export type DecisionContext = z.infer<typeof DecisionContext>;

export const CreativeDecision = z
  .object({
    schema_version: SemVer,
    resolver_version: SemVer,
    dataset_version: DatasetVersion,
    decision_id: Id,
    created_at: IsoDate,

    /** The project this decision belongs to. */
    project_id: Id,

    action: DecisionAction,
    actor: DecisionActor,
    note: Note.nullable(),

    subject: DecisionSubject,
    context: DecisionContext,

    /**
     * For `needs_correction`: the CorrectionRecommendation option codes the
     * human explicitly selected. Non-empty ONLY for `needs_correction`; a schema
     * refinement enforces this.
     */
    selected_correction_options: z.array(NonEmptyText),

    /** fnv1a(canonicalise(body without decision_id / created_at / decision_hash)). */
    decision_hash: Hash8
  })
  .strict()
  .superRefine((decision, ctx) => {
    if (decision.action === "needs_correction" && decision.selected_correction_options.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a needs_correction decision must carry at least one explicitly selected correction option"
      });
    }
    if (decision.action !== "needs_correction" && decision.selected_correction_options.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "only a needs_correction decision may carry selected correction options"
      });
    }
  });
export type CreativeDecision = z.infer<typeof CreativeDecision>;

/** The temporary local actor used until P2.20 wires real users. Grants nothing. */
export const LOCAL_CREATIVE_ACTOR: DecisionActor = {
  id: "local-creative",
  role: "creative",
  display_name: "Creative (local session)"
};
