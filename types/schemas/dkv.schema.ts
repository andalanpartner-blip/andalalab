import { z } from "zod";
import { NonEmptyText, Ratio } from "../primitives";

/**
 * The measurable spine of the product.
 *
 * These are not adjectives. Every one of them can be measured in a generated
 * image later (whitespace ratio, edge density, WCAG contrast, palette count,
 * saliency dominance), which is what turns the Design Critic from an opinion
 * into a comparison.
 */
export const DkvParams = z.object({
  whitespace: Ratio,
  contrast: Ratio,
  visual_density: Ratio,
  alignment: Ratio,
  hierarchy_strength: Ratio,
  color_complexity: Ratio,
  focal_dominance: Ratio,
  typographic_scale_ratio: z.number().min(1).max(4)
});
export type DkvParams = z.infer<typeof DkvParams>;

export const DKV_PARAM_KEYS = [
  "whitespace",
  "contrast",
  "visual_density",
  "alignment",
  "hierarchy_strength",
  "color_complexity",
  "focal_dominance",
  "typographic_scale_ratio"
] as const;
export type DkvParamKey = (typeof DKV_PARAM_KEYS)[number];

/** A partial DKV nudge contributed by a dataset entry (layout, movement...). */
export const DkvBias = DkvParams.partial();
export type DkvBias = z.infer<typeof DkvBias>;

/**
 * A constraint band on one DKV parameter, with provenance.
 *
 * The Design Contract carries bands, not final values. Final values are chosen
 * by the Design Direction engine in P1 — the contract only says what is legal.
 */
export const DkvRule = z
  .object({
    param: z.enum(DKV_PARAM_KEYS),
    min: z.number(),
    max: z.number(),
    target: z.number().optional(),
    source: NonEmptyText,
    doctrine_rank: z.number().int().min(1).max(10)
  })
  .superRefine((rule, ctx) => {
    if (rule.min > rule.max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `min > max for ${rule.param}` });
    }
    if (rule.target !== undefined && (rule.target < rule.min || rule.target > rule.max)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `target outside band for ${rule.param}` });
    }
  });
export type DkvRule = z.infer<typeof DkvRule>;

export const DkvRuleSet = z.array(DkvRule);
export type DkvRuleSet = z.infer<typeof DkvRuleSet>;
