import { z } from "zod";
import { NonEmptyText, Note, Ratio, SemVer, Slug } from "../../primitives";
import { DkvBias } from "../dkv.schema";
import { ZoneId } from "./layout.schema";

export const AspectRatio = z.object({
  id: Slug,
  label: NonEmptyText,
  width: z.number().int().positive(),
  height: z.number().int().positive()
});
export type AspectRatio = z.infer<typeof AspectRatio>;

/**
 * Visual Type — the structural rules of a deliverable.
 *
 * `text_render_risk` is the flag that will drive two-pass production in a later
 * phase: high risk means the image model should not be asked to render exact
 * copy, and TEXT_CRITICAL mode applies.
 */
export const VisualType = z.object({
  id: Slug,
  name: NonEmptyText,
  schema_version: SemVer,
  category: z.enum(["social", "poster", "editorial", "advertising", "web", "print", "presentation"]),

  aspect_ratios: z.array(AspectRatio).min(1),
  default_aspect_ratio: Slug,

  safe_area: z.object({
    top: Ratio,
    bottom: Ratio,
    left: Ratio,
    right: Ratio,
    reason: Note
  }),

  structural_rules: z.object({
    max_text_blocks: z.number().int().min(1).max(12),
    min_text_scale_px_at_1080: z.number().int().min(8).max(200),
    focal_requirement: Note,
    viewing_distance: z.enum(["thumb", "arm", "room", "street"]),
    scroll_context: z.boolean()
  }),

  allowed_zones: z.array(ZoneId).min(2),
  required_zones: z.array(ZoneId),
  default_layouts: z.array(Slug).min(1),
  text_render_risk: Ratio,
  dkv_bias: DkvBias
}).strict();
export type VisualType = z.infer<typeof VisualType>;
