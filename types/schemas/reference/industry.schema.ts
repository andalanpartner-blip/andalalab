import { z } from "zod";
import { NonEmptyText, Note, Ratio, SemVer, Slug } from "../../primitives";

/**
 * Industry Visual DNA.
 *
 * Industry provides CONSTRAINTS, not templates (doctrine §10). The five
 * pressure values are the useful part: they are what the Design Direction
 * engine scores candidates against in P1, and what makes "Healthcare outranks
 * Brutalism" a computation rather than an opinion.
 */
export const IndustryDNA = z.object({
  id: Slug,
  name: NonEmptyText,
  schema_version: SemVer,

  core_perception: Note,
  visual_traits: z.array(NonEmptyText).min(3),
  communication_needs: z.array(NonEmptyText).min(2),

  /** How hard this industry pushes on each axis. Drives candidate scoring. */
  trust_pressure: Ratio,
  conversion_pressure: Ratio,
  emotion_pressure: Ratio,
  information_pressure: Ratio,
  aesthetic_pressure: Ratio,

  composition: Note,
  typography: Note,
  color: Note,
  imagery: Note,

  /** Hard floors and ceilings this industry imposes on DKV parameters. */
  dkv_floor: z.object({ contrast: Ratio, hierarchy_strength: Ratio }),
  dkv_ceiling: z.object({ visual_density: Ratio, color_complexity: Ratio }),

  preferred_movements: z.array(Slug).min(1),
  avoid: z.array(Note).min(2)
}).strict();
export type IndustryDNA = z.infer<typeof IndustryDNA>;
