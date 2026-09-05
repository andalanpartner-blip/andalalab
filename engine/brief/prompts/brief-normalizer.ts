import type { DatasetRegistry } from "../../../types/datasets";
import { CommunicationObjective } from "../../../types/schemas/brief.schema";

/**
 * Versioned prompt template.
 *
 * The version is stored on every cost event and will be stored on every
 * artifact the interpreter produces, so a change in wording is always traceable
 * to the outputs it caused. Never edit a template in place — bump it.
 */
export const BRIEF_NORMALIZER_TEMPLATE_VERSION = "brief-normalizer@1.0.0";

export const BRIEF_NORMALIZER_SYSTEM = [
  "You are a brief interpreter for a design studio. You extract structure from",
  "client briefs written in Indonesian or English. You are not a designer and",
  "you make no design decisions: you report only what the brief actually says.",
  "You always reply with a single JSON object and nothing else."
].join(" ");

const list = (values: readonly string[]): string => values.join(" | ");

export function buildBriefNormalizerPrompt(
  rawBrief: string,
  datasets: DatasetRegistry
): string {
  const countries = [...datasets.countries.keys()].sort();
  const industries = [...datasets.industries.keys()].sort();
  const movements = [...datasets.movements.keys()].sort();
  const visualTypes = [...datasets.visualTypes.keys()].sort();
  const ratios = [
    ...new Set(
      [...datasets.visualTypes.values()].flatMap((type) =>
        type.aspect_ratios.map((ratio) => ratio.id)
      )
    )
  ].sort();

  return `Extract structured data from the client brief below.

RULES
1. Report only what the brief says. Never invent a value that is not there.
2. If something is not stated, set "value" to null and "confidence" to 0.
   A null is a correct answer. A guess is not.
3. Classify only using the allowed values listed below. Never invent a new one.
4. Copy mandatory and prohibited items using the client's own wording, in the
   original language. Do not translate, summarise or merge them.
5. Mandatories are things that MUST appear. Prohibitions are things that must
   NOT appear. Keep them in separate lists.
6. Record explicit requests for a country, style or movement exactly as asked.
   If the brief mentions a country only as a location and not as a visual
   influence, still record it — the engine decides what to do with it.
7. Country weights: if the client says something like "mostly X with a little
   Y", use weights that reflect that (for example 0.7 and 0.3). If they name
   one country, use 1. If they name none, return an empty list.
8. confidence is how certain you are that you EXTRACTED the field correctly.
   It is not a quality score and not a recommendation.
9. If the brief contradicts itself, record both readings in "contradictions"
   and set the affected field's confidence low.
10. Reply with one JSON object only. No commentary, no code fences.

ALLOWED VALUES
objective: ${list(CommunicationObjective.options)}
industry_id: ${list(industries)}
visual_type_id: ${list(visualTypes)}
movement_id: ${list(movements)}
country id: ${list(countries)}
platform.channel: instagram-feed | instagram-story | tiktok | facebook-feed | linkedin-feed | web | print | ooh
platform.aspect_ratio_id: ${list(ratios)}
platform.viewing_context: thumb | arm | room | street
audience.attention_context: scroll | search | dwell | captive
audience.sophistication: 0..1 (0 = no design literacy, 1 = highly design literate)
audience.price_sensitivity: 0..1 (0 = price is irrelevant, 1 = price decides)

SHAPE
Every field marked with {value, confidence} must be an object with exactly
those two keys. Arrays are plain arrays of strings unless shown otherwise.

{
  "objective": {"value": null, "confidence": 0},
  "core_message": {"value": null, "confidence": 0},
  "industry_id": {"value": null, "confidence": 0},
  "visual_type_id": {"value": null, "confidence": 0},
  "platform": {
    "channel": {"value": null, "confidence": 0},
    "aspect_ratio_id": {"value": null, "confidence": 0},
    "viewing_context": {"value": null, "confidence": 0}
  },
  "audience": {
    "description": {"value": null, "confidence": 0},
    "age_min": {"value": null, "confidence": 0},
    "age_max": {"value": null, "confidence": 0},
    "sophistication": {"value": null, "confidence": 0},
    "price_sensitivity": {"value": null, "confidence": 0},
    "attention_context": {"value": null, "confidence": 0},
    "cultural_context": []
  },
  "countries": [{"id": "indonesia", "weight": 1, "confidence": 0.9}],
  "movement_id": {"value": null, "confidence": 0},
  "brand_name": {"value": null, "confidence": 0},
  "deliverables": [],
  "mandatories": [],
  "prohibitions": [],
  "style_notes": [],
  "visual_references": [],
  "contradictions": []
}

BRIEF
"""
${rawBrief.trim()}
"""`;
}
