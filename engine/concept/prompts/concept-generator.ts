import type { DatasetRegistry } from "../../../types/datasets";
import type { DesignContract } from "../../../types/schemas/contract.schema";
import type { DesignDirection } from "../../../types/schemas/direction.schema";
import type { ConceptIssue } from "../../../types/schemas/concept.schema";

export const CONCEPT_GENERATOR_SYSTEM = [
  "You are a creative concept developer in a design studio. You propose ideas,",
  "not executions. The art direction has already been decided by a separate",
  "system and is not yours to change. You always reply with a single JSON",
  "object and nothing else."
].join(" ");

/**
 * The concept prompt.
 *
 * Three sections in a fixed order, because the model's most likely failure is
 * confusing them: the BRIEF is what the client wants, the DIRECTION is what the
 * engine has already decided and locked, and the CONCEPT is the only thing the
 * model is being asked for.
 */
export function buildConceptPrompt(input: {
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly datasets: DatasetRegistry;
  readonly count: number;
}): string {
  const { contract, direction, datasets } = input;
  const selected = direction.candidates.find(
    (candidate) => candidate.candidate.candidate_id === direction.selected_candidate_id
  );
  const movement = selected ? datasets.movements.get(selected.candidate.movement_id) : null;
  const layout = selected ? datasets.layouts.get(selected.candidate.layout_id) : null;
  const industry = datasets.industries.get(contract.industry.id);

  const blend = Object.entries(contract.country).sort((a, b) => b[1] - a[1]);
  const cultureLines = blend.map(([id, weight]) => {
    const country = datasets.countries.get(id);
    return `- ${country?.name ?? id} at ${Math.round(weight * 100)}%: ${country?.composition.spatial_behavior ?? ""}`;
  });

  const mandatories = contract.constraints.filter((c) => c.kind === "must");
  const prohibitions = contract.constraints.filter(
    (c) => c.kind === "must_not" || c.kind === "avoid"
  );

  return `Propose ${input.count} genuinely different creative concepts.

=== BRIEF — what the client wants ===
Objective: ${contract.objective}
Core message: ${contract.core_message}
Industry: ${industry?.name ?? contract.industry.id} — ${industry?.core_perception ?? ""}
Audience: ${contract.audience.description}
  attention: ${contract.audience.attention_context}, sophistication ${contract.audience.sophistication}, price sensitivity ${contract.audience.price_sensitivity}
Platform: ${contract.platform.channel}, ${contract.platform.aspect_ratio_id}, viewed at ${contract.platform.viewing_context}
Mandatory elements:
${mandatories.length > 0 ? mandatories.map((c) => `- ${c.statement}`).join("\n") : "- none"}
Forbidden directions:
${prohibitions.length > 0 ? prohibitions.map((c) => `- ${c.statement}`).join("\n") : "- none"}

=== DIRECTION — already decided, not yours to change ===
Movement: ${movement?.name ?? "unassigned"} — ${movement?.core_principles.slice(0, 3).join("; ") ?? ""}
Layout grammar: ${layout?.name ?? "unassigned"}
DKV targets: whitespace ${direction.dkv_targets.whitespace}, contrast ${direction.dkv_targets.contrast}, visual density ${direction.dkv_targets.visual_density}, hierarchy ${direction.dkv_targets.hierarchy_strength}
Cultural influence:
${cultureLines.join("\n")}

Do not redesign the design direction.
Do not change the assigned movement.
Do not change the layout grammar.
Do not change DKV parameters.
Do not invent a new industry interpretation.
Do not create concepts that violate mandatory constraints.

=== CONCEPT — what you are being asked for ===
A concept is a creative IDEA that can live inside the direction above. It is not
a layout, a palette, a typeface or a camera setting. Those are already decided.

Every concept must answer three questions:
  WHAT is the idea?              → big_idea
  WHY does it serve the objective? → why
  HOW does it become an image?    → visual_metaphor and visual_world

It must also name a real opposition in creative_tension. An idea with no tension
is a mood board.

Example of a CONCEPT:
  "Grand opening as a typographic threshold — the announcement becomes the
   doorway the product passes through, so the words are the entrance rather
   than a label stuck on one."

Example of EXECUTION, which is NOT wanted:
  "Use large bold type in red with soft lighting."

RULES
1. The ${input.count} concepts must differ in KIND, not in styling. Different
   colour, lighting, typography or background is the same concept twice.
   Change what is shown, who is present, what the tension is, how it is told.
2. Never write filler such as "modern and beautiful", "clean and elegant",
   "premium lifestyle" or "visually appealing". Name what is in the frame.
3. Cultural influence is spatial behaviour, material discipline, rhythm and
   proportion — never a motif. A minority culture in the blend may appear as
   restraint, reduction, material choice or spatial calm. Never as a national
   symbol, script, flower, pattern or landmark.
4. Respect every mandatory element and every forbidden direction above.
5. Write in English. Use concrete nouns and verbs.

Reply with one JSON object only, no code fences:

{
  "concepts": [
    {
      "name": "short memorable name",
      "type": "product_hero | human_story | visual_metaphor | cultural_reinterpretation | transformation | contrast | minimal_statement | editorial_narrative | unexpected_juxtaposition | data_information | lifestyle_aspiration | brand_world",
      "big_idea": "one sentence, what the idea is",
      "creative_tension": "the opposition the idea runs on",
      "visual_metaphor": "the image that carries the idea",
      "why": "how this serves the objective for this audience",
      "visual_world": "place, materials, staging, time of day",
      "emotional_direction": "calm | warm | urgent | confident | playful | reverent | curious | austere",
      "subject_strategy": "product-as-subject | person-as-subject | place-as-subject | typography-as-subject | material-as-subject | process-as-subject | absence-as-subject",
      "narrative_strategy": "single-moment | before-after | sequence | juxtaposition | reveal | statement | documentary",
      "composition_intent": "single-object-focus | figure-in-environment | grid-of-parts | typographic-field | layered-depth | wide-context",
      "human_presence": "none | implied | partial | central | crowd",
      "abstraction_level": "literal | stylised | symbolic | abstract",
      "temporal_strategy": "instant | anticipation | aftermath | ritual-repetition | timeless",
      "interaction_strategy": "observed | addressed | invited | participatory",
      "best_for": ["what this concept is strongest at"],
      "risk": "the honest weakness of this concept"
    }
  ]
}`;
}

/**
 * The regeneration prompt.
 *
 * Deterministic: it quotes the exact issues the engine raised and the exact
 * concepts that must not be repeated. It never re-explains the brief, which
 * would invite the model to reinterpret the whole job.
 */
export function buildRegenerationPrompt(input: {
  readonly basePrompt: string;
  readonly keptSummaries: readonly string[];
  readonly issues: readonly ConceptIssue[];
  readonly count: number;
}): string {
  const issueLines = input.issues
    .slice(0, 12)
    .map((issue) => `- [${issue.code}] ${issue.field}: ${issue.message} → ${issue.fix}`)
    .join("\n");

  return `${input.basePrompt}

=== REGENERATION ===
Some concepts were rejected. Replace ONLY them: propose ${input.count} new
concept(s) in the same JSON shape.

These concepts are being kept. Your new concept must differ from them in KIND —
different subject, different tension, different way of telling it. A different
palette, light or typeface does not count:
${input.keptSummaries.map((summary) => `- ${summary}`).join("\n")}

Rejected for these reasons:
${issueLines}

Reply with one JSON object containing exactly ${input.count} concept(s).`;
}
