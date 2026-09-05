import { z } from "zod";
import type { DatasetRegistry } from "../../types/datasets";
import { CommunicationObjective } from "../../types/schemas/brief.schema";

/**
 * The LLM output contract.
 *
 * Deliberately NOT the NormalizedBrief. The model reports what it found in the
 * text, with a confidence per field and null wherever it found nothing. Turning
 * that into a NormalizedBrief is a separate, deterministic step.
 *
 * Keeping the two apart is what stops the model from silently supplying a
 * design decision: it can say "the brief mentions Japan", it cannot say "use a
 * 0.7/0.3 Indonesia-Japan blend with asymmetric composition".
 */

const Confidence = z.number().min(0).max(1);

/** A value the model may not know, always carrying how sure it is. */
const field = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({ value: schema.nullable(), confidence: Confidence });

const Text = z.string().trim().min(1);

/**
 * Ids are validated against the datasets that are actually loaded, so an
 * invented industry fails schema validation and triggers the repair loop
 * rather than reaching the engine.
 */
const idIn = (ids: readonly string[], label: string) =>
  z.string().trim().toLowerCase().refine((value) => ids.includes(value), {
    message: `must be one of the known ${label}: ${ids.join(", ")}`
  });

export function buildExtractionSchema(datasets: DatasetRegistry) {
  const countryIds = [...datasets.countries.keys()].sort();
  const industryIds = [...datasets.industries.keys()].sort();
  const movementIds = [...datasets.movements.keys()].sort();
  const visualTypeIds = [...datasets.visualTypes.keys()].sort();
  const aspectRatioIds = [
    ...new Set(
      [...datasets.visualTypes.values()].flatMap((type) =>
        type.aspect_ratios.map((ratio) => ratio.id)
      )
    )
  ].sort();

  return z
    .object({
      objective: field(CommunicationObjective),
      core_message: field(Text),
      industry_id: field(idIn(industryIds, "industries")),
      visual_type_id: field(idIn(visualTypeIds, "visual types")),

      platform: z.object({
        channel: field(
          z.enum([
            "instagram-feed",
            "instagram-story",
            "tiktok",
            "facebook-feed",
            "linkedin-feed",
            "web",
            "print",
            "ooh"
          ])
        ),
        aspect_ratio_id: field(idIn(aspectRatioIds, "aspect ratios")),
        viewing_context: field(z.enum(["thumb", "arm", "room", "street"]))
      }),

      audience: z.object({
        description: field(Text),
        age_min: field(z.number().int().min(0).max(120)),
        age_max: field(z.number().int().min(0).max(120)),
        sophistication: field(Confidence),
        price_sensitivity: field(Confidence),
        attention_context: field(z.enum(["scroll", "search", "dwell", "captive"])),
        cultural_context: z.array(Text).default([])
      }),

      /** Explicit country requests only. Weights are the user's, not the model's. */
      countries: z
        .array(
          z.object({
            id: idIn(countryIds, "countries"),
            weight: z.number().min(0).max(1),
            confidence: Confidence
          })
        )
        .default([]),

      movement_id: field(idIn(movementIds, "movements")),
      brand_name: field(Text),

      deliverables: z.array(Text).default([]),
      mandatories: z.array(Text).default([]),
      prohibitions: z.array(Text).default([]),
      style_notes: z.array(Text).default([]),
      visual_references: z.array(Text).default([]),

      /** Anything the model noticed that contradicts itself in the brief. */
      contradictions: z.array(Text).default([])
    })
    .strict();
}

/**
 * The OUTPUT type — after Zod has applied array defaults. Using z.input here
 * would leave every defaulted array optional and push the guard work onto
 * every consumer.
 */
export type BriefExtraction = z.output<ReturnType<typeof buildExtractionSchema>>;
