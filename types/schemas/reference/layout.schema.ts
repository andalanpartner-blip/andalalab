import { z } from "zod";
import { NonEmptyText, Note, Ratio, SemVer, Slug } from "../../primitives";
import { DkvBias } from "../dkv.schema";

/** The zone vocabulary from doctrine §12. Layout grammars compose these. */
export const ZoneId = z.enum([
  "hero",
  "headline",
  "body",
  "product",
  "image",
  "offer",
  "data",
  "cta",
  "brand",
  "navigation",
  "footer"
]);
export type ZoneId = z.infer<typeof ZoneId>;

export const LayoutZone = z.object({
  id: ZoneId,
  priority: z.number().int().min(1).max(11),
  area_share: Ratio,
  required: z.boolean()
});

export const LayoutSystem = z
  .object({
    id: Slug,
    name: NonEmptyText,
    schema_version: SemVer,
    description: Note,

    grid: z.object({
      columns: z.number().int().min(1).max(24),
      rows: z.number().int().min(1).max(24),
      gutter_ratio: Ratio,
      margin_ratio: Ratio
    }),

    zones: z.array(LayoutZone).min(2),
    flow: z.enum(["z-pattern", "f-pattern", "centre-out", "top-down", "diagonal"]),
    density: Ratio,
    complexity: Ratio,
    spacing: Note,
    responsive_behavior: Note,

    dkv_bias: DkvBias,
    suitable_visual_types: z.array(Slug).min(1)
  })
  .superRefine((layout, ctx) => {
    const share = layout.zones.reduce((total, zone) => total + zone.area_share, 0);
    if (share > 1.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `zone area_share sums to ${share.toFixed(3)}, must be <= 1`
      });
    }
    const ids = layout.zones.map((zone) => zone.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate zone id" });
    }
  });
export type LayoutSystem = z.infer<typeof LayoutSystem>;
