import { z } from "zod";
import { NonEmptyText, Note, Ratio, SemVer, Slug } from "../../primitives";
import { DkvBias } from "../dkv.schema";

/**
 * Design Movement.
 *
 * A movement is a set of PRINCIPLES, not a decorative preset (doctrine §6).
 * Swiss Style contributes grid, alignment and hierarchy behaviour — not a
 * Helvetica sticker. `dkv_bias` is how a movement actually reaches the output:
 * it nudges measurable parameters, and those nudges are later checked against
 * the generated image.
 */
export const DesignMovement = z.object({
  id: Slug,
  name: NonEmptyText,
  schema_version: SemVer,
  period: NonEmptyText,

  core_principles: z.array(NonEmptyText).min(3),
  visual_traits: z.array(NonEmptyText).min(3),

  composition: Note,
  grid: z.object({
    logic: Note,
    preferred_columns: z.array(z.number().int().min(1).max(24)).min(1),
    modularity: Ratio
  }),
  typography: z.object({
    logic: Note,
    scale_ratio: z.number().min(1).max(4),
    case_bias: z.enum(["lower", "sentence", "title", "upper", "mixed"]),
    weight_bias: z.enum(["light", "regular", "medium", "bold", "mixed"])
  }),
  color: z.object({
    logic: Note,
    palette_size: z.number().int().min(1).max(12),
    saturation_bias: Ratio
  }),
  imagery: Note,
  materiality: Note,
  shape_language: Note,

  dkv_bias: DkvBias,

  suitable_industries: z.array(Slug).min(1),
  suitable_objectives: z.array(Slug).min(1),
  /** Blend affinity with other movements, 0 = incompatible, 1 = natural pair. */
  compatibility: z.record(Slug, Ratio),

  /** Misreadings of this movement that the system must not produce. */
  anti_stereotype: z.array(Note).min(2)
}).strict();
export type DesignMovement = z.infer<typeof DesignMovement>;
