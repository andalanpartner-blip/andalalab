import { z } from "zod";
import { Id, NonEmptyText, Note } from "../primitives";

/**
 * Correction Engine — P6.
 *
 * A correction is a bounded, structured adjustment to a finished Design Recipe.
 * It is NOT a redesign: it may nudge the measurable design parameters and a few
 * dataset-derived biases, and nothing else. Anything that would move a locked
 * anchor — the movement, the layout, the composition strategy, the concept, the
 * objective or the core message — is rejected as REDESIGN, never applied.
 *
 * Corrections are immutable: the parent recipe is never mutated. Every accepted
 * correction produces a NEW derived recipe with `derived_from = parent.id`
 * (ADR 0004), which is then re-compiled, re-guarded (P3.0) and re-audited
 * (P4.0). See `docs/correction-engine.md`.
 *
 * V1 takes structured input only — there is no natural-language front door and
 * no new model call.
 */

/**
 * The bounded correction surface.
 *
 * The first eight are the DKV parameters — a correction to any of them is
 * applied as a doctrine-rank-2 target claim and flows through `resolveDkv`, so
 * the derived recipe stays internally consistent (it still passes the P4.0
 * `dkv-consistency` check). The last four are dataset-derived biases fed into
 * the recipe build before photographic character / graphic treatment resolve,
 * so a change to them propagates coherently.
 *
 * "Framing / crop" corrections are expressed through `imagery_realism` (more
 * photographic vs. more graphic), `focal_dominance` (tighter focal claim) and
 * `whitespace` (less margin) — the imagery framing prose itself is the
 * country's visual philosophy and a correction never rewrites it.
 */
export const CorrectionField = z.enum([
  "whitespace",
  "contrast",
  "visual_density",
  "alignment",
  "hierarchy_strength",
  "color_complexity",
  "focal_dominance",
  "typographic_scale_ratio",
  "color_saturation",
  "imagery_realism",
  "materiality_texture",
  "graphic_ornament"
]);
export type CorrectionField = z.infer<typeof CorrectionField>;

/** DKV correction fields flow through `resolveDkv`; the rest are recipe-build biases. */
export const DKV_CORRECTION_FIELDS = [
  "whitespace",
  "contrast",
  "visual_density",
  "alignment",
  "hierarchy_strength",
  "color_complexity",
  "focal_dominance",
  "typographic_scale_ratio"
] as const;
export type DkvCorrectionField = (typeof DKV_CORRECTION_FIELDS)[number];

export const CorrectionAdjustment = z.object({
  field: CorrectionField,
  /**
   * `set` — `amount` is the desired value.
   * `increase` / `decrease` — `amount` is a positive delta applied to the
   * parent's current value.
   */
  mode: z.enum(["set", "increase", "decrease"]),
  amount: z.number(),
  /** Optional reviewer note for this one adjustment. */
  note: Note.optional()
});
export type CorrectionAdjustment = z.infer<typeof CorrectionAdjustment>;

export const CorrectionPatch = z.object({
  adjustments: z.array(CorrectionAdjustment).min(1),
  /** Optional overall note for the correction. */
  note: Note.optional()
});
export type CorrectionPatch = z.infer<typeof CorrectionPatch>;

// --- result ------------------------------------------------------------

export const CorrectionOutcome = z.enum(["adjustment", "redesign", "noop"]);
export type CorrectionOutcome = z.infer<typeof CorrectionOutcome>;

/** One field that actually moved, with what was asked and what was resolved. */
export const AppliedChange = z.object({
  field: CorrectionField,
  requested: z.number(),
  resolved: z.number(),
  /** Set when the request was clamped — names the band / limit that held it. */
  held_by: NonEmptyText.optional()
});
export type AppliedChange = z.infer<typeof AppliedChange>;

export const CorrectionReport = z.object({
  outcome: CorrectionOutcome,
  /** Plain-language explanation — always present, whatever the outcome. */
  reason: Note,
  /** The fields that changed (empty for `noop` / `redesign`). */
  changes: z.array(AppliedChange),
  /**
   * A compact projection of `diffRecipes(parent, derived)` for the reviewer.
   * `structural_changes` is non-empty only for a `redesign` verdict.
   */
  diff: z.object({
    changed_paths: z.array(NonEmptyText),
    dkv_delta: z.record(z.string(), z.number()),
    anchor_violations: z.array(NonEmptyText),
    structural_changes: z.array(NonEmptyText)
  }),
  /**
   * `derived_from` lineage of the produced recipe, root-first:
   * `[..., grandparent, parent, derived]`. Empty for `redesign` / `noop`.
   */
  lineage: z.array(Id)
});
export type CorrectionReport = z.infer<typeof CorrectionReport>;
