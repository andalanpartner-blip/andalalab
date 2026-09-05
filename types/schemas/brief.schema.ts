import { z } from "zod";
import { Id, NonEmptyText, Note, Ratio, SemVer, Slug, weightsSumToOne } from "../primitives";

/**
 * Communication objectives. Closed enum on purpose: "objective" is doctrine
 * rank 1 and must never be free text the engine cannot reason about.
 */
export const CommunicationObjective = z.enum([
  "awareness",
  "consideration",
  "conversion",
  "launch",
  "promotion",
  "education",
  "trust",
  "brand-building",
  "recruitment",
  "event"
]);
export type CommunicationObjective = z.infer<typeof CommunicationObjective>;

export const AudienceSpec = z.object({
  description: Note,
  age_range: z.tuple([z.number().int().min(0), z.number().int().max(120)]),
  sophistication: Ratio,
  price_sensitivity: Ratio,
  attention_context: z.enum(["scroll", "search", "dwell", "captive"]),
  cultural_context: z.array(NonEmptyText).default([])
});
export type AudienceSpec = z.infer<typeof AudienceSpec>;

export const PlatformSpec = z.object({
  channel: z.enum([
    "instagram-feed",
    "instagram-story",
    "tiktok",
    "facebook-feed",
    "linkedin-feed",
    "web",
    "print",
    "ooh"
  ]),
  aspect_ratio_id: Slug,
  viewing_context: z.enum(["thumb", "arm", "room", "street"]),
  localised_text: z.boolean().default(true)
});
export type PlatformSpec = z.infer<typeof PlatformSpec>;

/** Country influence as a weighted blend. Weights must sum to 1. */
export const CountryBlend = weightsSumToOne(z.record(Slug, Ratio)).refine(
  (blend) => Object.keys(blend).length >= 1,
  "at least one country is required"
);
export type CountryBlend = z.infer<typeof CountryBlend>;

/**
 * The output of the Brief Interpreter (P2, LLM) — or of a human filling the
 * same shape by hand, which is how P0 tests it. The engine never sees raw text.
 */
export const NormalizedBrief = z.object({
  brief_id: Id,
  schema_version: SemVer,
  raw_input: z.string(),

  objective: CommunicationObjective,
  core_message: Note,
  audience: AudienceSpec,
  industry_id: Slug,
  brand_id: Id.nullable(),
  visual_type_id: Slug,
  country: CountryBlend,
  movement_id: Slug.nullable().default(null),
  layout_id: Slug.nullable().default(null),
  platform: PlatformSpec,

  deliverables: z.array(NonEmptyText).min(1),
  mandatories: z.array(NonEmptyText).default([]),
  prohibitions: z.array(NonEmptyText).default([]),

  /** Per-field confidence from the interpreter. 1.0 when human-authored. */
  confidence: z.record(z.string(), Ratio).default({}),
  missing_fields: z.array(z.string()).default([])
});
export type NormalizedBrief = z.infer<typeof NormalizedBrief>;
