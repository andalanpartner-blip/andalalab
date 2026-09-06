import { z } from "zod";
import { DatasetVersion, Id, IsoDate, Note, SemVer } from "../primitives";
import { CorrectionReport } from "./correction.schema";

/**
 * Correction Cycle — P2.17.
 *
 * The immutable lineage record of ONE explicit correction pass:
 *
 *   parent generated visual
 *     → visual evidence
 *     → design critique
 *     → correction recommendation
 *     → [human selects options]
 *     → corrected recipe (via the unchanged P6 engine)
 *     → fresh blueprint + fresh prompt
 *
 * It does NOT contain a new generated artifact — regeneration is a separate,
 * explicitly-triggered step. It records what the parent was and what the
 * correction produced, so the chain is auditable.
 *
 * There is NO autonomous loop: one cycle is created per explicit user action,
 * and creating a cycle never triggers the next one.
 */

const Hash8 = z.string().length(8);

export const CorrectionCycle = z
  .object({
    schema_version: SemVer,
    cycle_id: Id,
    created_at: IsoDate,
    dataset_version: DatasetVersion,

    /** Everything this cycle was derived from. */
    parent: z
      .object({
        generated_artifact_id: Id,
        artifact_hash: Hash8,
        recipe_id: Id,
        recipe_hash: Hash8,
        blueprint_hash: Hash8.nullable(),
        evidence_id: Id,
        evidence_hash: Hash8,
        critique_id: Id,
        critique_hash: Hash8,
        recommendation_id: Id,
        recommendation_hash: Hash8
      })
      .strict(),

    /** The option codes the human selected. Never auto-selected. */
    selected_options: z.array(z.string()),
    /** Options asked for but not applied as a parameter change (regenerate-only, etc.). */
    skipped_options: z.array(z.string()),

    /** The P6 correction result, embedded verbatim. */
    correction: CorrectionReport,

    /** What the correction produced. Null when the outcome was redesign / noop. */
    corrected: z
      .object({
        recipe_id: Id,
        recipe_hash: Hash8,
        blueprint_hash: Hash8,
        prompt_hash: Hash8
      })
      .strict()
      .nullable(),

    /**
     * Whether a regeneration has happened yet. Always false when the cycle is
     * created — regeneration is a later explicit step, tracked separately.
     */
    regenerated: z.literal(false),

    note: Note,

    /** fnv1a(canonicalise(body without cycle_id / created_at / cycle_hash)). */
    cycle_hash: Hash8
  })
  .strict();
export type CorrectionCycle = z.infer<typeof CorrectionCycle>;
