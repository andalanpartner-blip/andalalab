import { z } from "zod";
import { DatasetVersion, Id, IsoDate, NonEmptyText, Note, SemVer, Slug } from "../primitives";
import { DkvRuleSet } from "./dkv.schema";
import { BrandSnapshot } from "./brand.schema";
import { AudienceSpec, CommunicationObjective, CountryBlend, PlatformSpec } from "./brief.schema";

/**
 * Immutable anchors (doctrine §17).
 *
 * Anchors are what prevents visual drift across correction loops. Some can be
 * locked at contract time (brand, objective, core message); concept and primary
 * visual direction do not exist yet and are carried as `pending` until the
 * recipe stage locks them. A correction patch that would change a locked anchor
 * does not silently fail — it escalates to human approval.
 */
export const AnchorKind = z.enum([
  "brand",
  "objective",
  "core_message",
  "concept",
  "primary_visual_direction"
]);
export type AnchorKind = z.infer<typeof AnchorKind>;

export const ImmutableAnchor = z.object({
  kind: AnchorKind,
  value: z.string(),
  status: z.enum(["locked", "pending"]),
  locked_at_stage: z.enum(["contract", "concept", "recipe"]),
  rationale: Note
});
export type ImmutableAnchor = z.infer<typeof ImmutableAnchor>;

export const ConstraintSource = z.enum([
  "brief",
  "brand",
  "industry",
  "visual_type",
  "platform",
  "country",
  "doctrine"
]);

export const Constraint = z.object({
  id: Slug,
  source: ConstraintSource,
  kind: z.enum(["must", "must_not", "prefer", "avoid"]),
  statement: NonEmptyText,
  /** Doctrine rank (1 = highest). Used to resolve conflicts in P1. */
  doctrine_rank: z.number().int().min(1).max(10)
});
export type Constraint = z.infer<typeof Constraint>;

export const ArtifactMeta = z.object({
  id: Id,
  project_id: Id,
  schema_version: SemVer,
  dataset_version: DatasetVersion,
  created_at: IsoDate,
  created_by: z.string().min(1)
});

/**
 * The Design Contract — the shared source of truth for the Designer, Art
 * Director, Prompt Compiler, Design Critic and Campaign System.
 *
 * Immutable once built (`frozen: true` and Object.freeze applied). Revisions
 * create new derived artifacts that reference this one; they never mutate it.
 */
export const DesignContract = ArtifactMeta.extend({
  brief_id: Id,
  objective: CommunicationObjective,
  core_message: Note,
  audience: AudienceSpec,

  industry: z.object({ id: Slug, name: NonEmptyText }),
  visual_type: z.object({ id: Slug, name: NonEmptyText, aspect_ratio_id: Slug }),
  layout: z.object({ id: Slug, name: NonEmptyText }).nullable(),
  movement: z.object({ id: Slug, name: NonEmptyText }).nullable(),
  brand: BrandSnapshot.nullable(),
  country: CountryBlend,
  platform: PlatformSpec,

  dkv_rules: DkvRuleSet,
  constraints: z.array(Constraint),
  anchors: z.array(ImmutableAnchor).min(3),

  /** Banned tokens harvested from every country in the blend (doctrine §5). */
  banned_tokens: z.array(z.string()),

  concept_id: Id.nullable(),
  frozen: z.literal(true),
  /** Stable hash of the canonical contract body. Determinism check. */
  contract_hash: z.string().length(8)
});
export type DesignContract = z.infer<typeof DesignContract>;
