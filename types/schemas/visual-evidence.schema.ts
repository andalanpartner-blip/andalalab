import { z } from "zod";
import { Id, NonEmptyText, Note, Ratio, SemVer } from "../primitives";

/**
 * Visual Evidence — P4.1.
 *
 * A bounded, structured description of what is actually observed in ONE rendered
 * candidate image. It is the only way the Visual Review critic is allowed to
 * make a visual-quality or technical-quality claim: no evidence, no claim.
 *
 * This is deliberately NOT computer vision. It is the shape a human reviewer, a
 * QA fixture, or (later) a vision model fills in. The critic treats it as data,
 * never re-derives it, and binds it to a specific recipe by `recipe_hash` so a
 * stale observation can never be applied to a design it was not made against.
 *
 * See `docs/visual-review.md` and ADR 0009.
 */

/** The twelve review categories. A superset of the P4.0 areas. */
export const ReviewCategory = z.enum([
  "communication",
  "composition",
  "hierarchy",
  "typography",
  "color",
  "imagery",
  "brand_fit",
  "industry_fit",
  "cultural_fit",
  "movement_fit",
  "platform_fit",
  "technical_quality"
]);
export type ReviewCategory = z.infer<typeof ReviewCategory>;

/** P0 critical · P1 major · P2 moderate · P3 minor. */
export const ReviewSeverity = z.enum(["P0", "P1", "P2", "P3"]);
export type ReviewSeverity = z.infer<typeof ReviewSeverity>;

/**
 * One observed thing. `polarity` says whether it helps or hurts the design;
 * `severity_hint` is the reviewer's suggested weight for a concern (the critic
 * may keep or override it deterministically, but never invents one).
 */
export const EvidenceObservation = z.object({
  category: ReviewCategory,
  statement: Note,
  polarity: z.enum(["supports", "concern", "neutral"]),
  severity_hint: ReviewSeverity.nullable().default(null),
  confidence: Ratio
});
export type EvidenceObservation = z.infer<typeof EvidenceObservation>;

export const VisualEvidence = z
  .object({
    schema_version: SemVer,
    evidence_id: Id,
    /** The 8-char content hash of the recipe this image was rendered from. */
    recipe_hash: z.string().length(8),
    /** Where the observations came from. Fixtures and humans only, for now. */
    source: z.enum(["fixture", "human-review", "vision-model"]),
    /** Free-text traceability, e.g. the brief or fixture name. */
    captured_for: NonEmptyText,
    /** The rendered aspect ratio versus what the recipe asked for, e.g. "4:5". */
    aspect_ratio: z.object({
      observed: NonEmptyText,
      expected: NonEmptyText
    }),
    /** What the frame does with text — a pure visual should render none. */
    text_render: z.object({
      rendered_text_present: z.boolean(),
      /** null unless the recipe is TEXT_CRITICAL and the message was expected. */
      core_message_legible: z.boolean().nullable().default(null)
    }),
    /** Technical defects seen in the frame — one plain statement each. */
    artifacts: z.array(Note).default([]),
    /** Design and visual observations. */
    observations: z.array(EvidenceObservation).default([])
  })
  .strict();
export type VisualEvidence = z.infer<typeof VisualEvidence>;
