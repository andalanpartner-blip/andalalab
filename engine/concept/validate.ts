import type { DatasetRegistry } from "../../types/datasets";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DesignDirection } from "../../types/schemas/direction.schema";
import type { ConceptIssue, ConceptProposal } from "../../types/schemas/concept.schema";
import type { ConceptLexicon } from "../../types/schemas/reference/lexicon.schema";
import type { DesignMovement } from "../../types/schemas/reference/movement.schema";
import { clampRatio, round } from "../dkv/params";
import { CONCEPTUAL_FIELDS, SPECIFICITY } from "./config";
import { conceptLexicon, contentWords, tokenise } from "./lexicon";

/**
 * Deterministic concept validation.
 *
 * The model proposes; this decides. Every check here is lexical and rule-based,
 * which is both its strength and its limit: it reliably catches filler, repaint
 * and cliché, and it cannot tell a brilliant idea from a competent one. That
 * judgement stays with a human, and the engine's job is to make sure nothing
 * obviously broken reaches them.
 */

export type ConceptValidation = {
  readonly issues: readonly ConceptIssue[];
  readonly specificity: number;
  readonly passed: boolean;
};

const issue = (
  code: ConceptIssue["code"],
  severity: ConceptIssue["severity"],
  field: string,
  message: string,
  reason: string,
  fix: string
): ConceptIssue => ({ code, severity, field, message, reason, fix });

const fieldText = (proposal: ConceptProposal, field: string): string =>
  String((proposal as unknown as Record<string, unknown>)[field] ?? "");

/** ---------------------------------------------------------------- 7A generic */

function checkGenericLanguage(
  proposal: ConceptProposal,
  lexicon: ConceptLexicon
): ConceptIssue[] {
  const issues: ConceptIssue[] = [];

  for (const field of CONCEPTUAL_FIELDS) {
    const text = fieldText(proposal, field).toLowerCase();
    for (const phrase of lexicon.banned_phrases) {
      if (!text.includes(phrase.toLowerCase())) continue;
      issues.push(
        issue(
          "GENERIC_LANGUAGE",
          "critical",
          field,
          `"${phrase}" is advertising filler, not a concept.`,
          "The phrase describes how someone should feel about the design instead of what the design shows. It would fit any brief in any industry, which is what makes it useless as a concept.",
          "State what is actually in the frame and what tension it creates. Replace the phrase with a subject, an action and a consequence."
        )
      );
      break;
    }
  }

  return issues;
}

/** ---------------------------------------------------------------- 7B specificity */

export type SpecificityReport = {
  readonly score: number;
  readonly unique_content_words: number;
  readonly vagueness_ratio: number;
  readonly lexical_variety: number;
  readonly styling_ratio: number;
  readonly thin_fields: readonly string[];
};

/**
 * Specificity, measured as ratios rather than length.
 *
 * A long paragraph of "modern premium elegant" prose scores worse than one
 * concrete sentence, which is the point: the failure mode being guarded against
 * is fluent emptiness, and fluent emptiness is usually long.
 */
export function measureSpecificity(
  proposal: ConceptProposal,
  lexicon: ConceptLexicon
): SpecificityReport {
  const vague = new Set(lexicon.vague_words);
  const styling = new Set(lexicon.styling_words);

  const all: string[] = [];
  const thin: string[] = [];

  for (const field of CONCEPTUAL_FIELDS) {
    const words = contentWords(fieldText(proposal, field), lexicon);
    const meaningful = words.filter((word) => !vague.has(word));
    if (new Set(meaningful).size < SPECIFICITY.minFieldContentWords) thin.push(field);
    all.push(...words);
  }

  const unique = new Set(all);
  const vagueCount = all.filter((word) => vague.has(word)).length;
  const stylingCount = all.filter((word) => styling.has(word)).length;

  const vaguenessRatio = all.length === 0 ? 1 : vagueCount / all.length;
  const variety = all.length === 0 ? 0 : unique.size / all.length;
  const stylingRatio = all.length === 0 ? 0 : stylingCount / all.length;
  const concrete = [...unique].filter((word) => !vague.has(word) && !styling.has(word));

  // Concreteness, variety and freedom from styling talk make up the base.
  const base =
    0.5 * Math.min(1, concrete.length / SPECIFICITY.minUniqueContentWords) +
    0.25 * Math.min(1, variety / SPECIFICITY.minLexicalVariety) +
    0.25 * (1 - Math.min(1, stylingRatio / SPECIFICITY.maxStylingRatio));

  // Vagueness is a MULTIPLIER, not a fourth term to be averaged away. Prose
  // that is 70% mood adjectives must not score 0.7 because it happened to use
  // enough distinct words while saying nothing — which is exactly what an
  // additive formula let through.
  const vaguenessPenalty = clampRatio(
    1 - Math.min(1.05, vaguenessRatio / SPECIFICITY.maxVaguenessRatio) * 0.9
  );

  const score = round(base * vaguenessPenalty);

  return {
    score,
    unique_content_words: concrete.length,
    vagueness_ratio: round(vaguenessRatio),
    lexical_variety: round(variety),
    styling_ratio: round(stylingRatio),
    thin_fields: thin
  };
}

function checkSpecificity(report: SpecificityReport): ConceptIssue[] {
  const issues: ConceptIssue[] = [];

  if (report.unique_content_words < SPECIFICITY.minUniqueContentWords) {
    issues.push(
      issue(
        "INSUFFICIENT_SPECIFICITY",
        "critical",
        "big_idea",
        `Only ${report.unique_content_words} concrete words across the conceptual fields; ${SPECIFICITY.minUniqueContentWords} are required.`,
        "There is not enough concrete material here to brief a photographer or a designer from.",
        "Name the subject, the setting, the action and the consequence. Nouns and verbs, not adjectives."
      )
    );
  }

  if (report.vagueness_ratio > SPECIFICITY.maxVaguenessRatio) {
    issues.push(
      issue(
        "INSUFFICIENT_SPECIFICITY",
        "critical",
        "big_idea",
        `${Math.round(report.vagueness_ratio * 100)}% of the content words are mood adjectives.`,
        "Adjectives about quality describe a reaction to the work rather than the work. Length does not fix this — a long paragraph of them is still empty.",
        "Delete every adjective that could describe any well-made design and rewrite what remains."
      )
    );
  }

  if (report.lexical_variety < SPECIFICITY.minLexicalVariety) {
    issues.push(
      issue(
        "INSUFFICIENT_SPECIFICITY",
        "major",
        "visual_world",
        `Lexical variety ${report.lexical_variety} is below ${SPECIFICITY.minLexicalVariety}.`,
        "The same words are being restated across the fields, so the fields are not adding information.",
        "Make each field do a different job: the idea, the tension, the image, the reason, the world."
      )
    );
  }

  if (report.styling_ratio > SPECIFICITY.maxStylingRatio) {
    issues.push(
      issue(
        "INSUFFICIENT_SPECIFICITY",
        "major",
        "visual_metaphor",
        `${Math.round(report.styling_ratio * 100)}% of the content words are styling vocabulary.`,
        "Colour, lighting, typography and lens are execution. The design direction already decides them, and a concept made of them is not a concept.",
        "Describe the idea the styling would serve, not the styling."
      )
    );
  }

  for (const field of report.thin_fields) {
    issues.push(
      issue(
        "INSUFFICIENT_SPECIFICITY",
        "major",
        field,
        `"${field}" carries fewer than ${SPECIFICITY.minFieldContentWords} distinct concrete words.`,
        "This field is one of the five that must answer WHAT, WHY or HOW, and it currently answers none of them.",
        "Rewrite it with a specific subject and a specific consequence."
      )
    );
  }

  return issues;
}

/** ---------------------------------------------------------------- 7C constraints */

/**
 * Every lowercase phrasing that names a movement in free text: its `id` with
 * hyphens spaced, its display `name`, and its data-authored `aliases`. Nothing
 * here is hardcoded — a new movement file brings its own names.
 */
function movementNamePhrases(movement: DesignMovement): string[] {
  return [
    movement.id.replace(/-/g, " "),
    movement.name.toLowerCase(),
    ...movement.aliases.map((alias) => alias.toLowerCase())
  ].filter((phrase) => phrase.length >= 4);
}

function checkConstraints(
  proposal: ConceptProposal,
  contract: DesignContract,
  direction: DesignDirection,
  datasets: DatasetRegistry,
  lexicon: ConceptLexicon
): ConceptIssue[] {
  const issues: ConceptIssue[] = [];
  const haystack = CONCEPTUAL_FIELDS.map((field) => fieldText(proposal, field))
    .join(" ")
    .toLowerCase();
  const tokens = new Set(tokenise(haystack));

  // A concept may not reassign the movement the engine already chose. The set
  // of movements it could name is the loaded dataset, not a fixed list.
  const selected = direction.candidates.find(
    (candidate) => candidate.candidate.candidate_id === direction.selected_candidate_id
  );
  const chosenMovement = selected?.candidate.movement_id;

  for (const movement of datasets.movements.values()) {
    if (movement.id === chosenMovement) continue;
    const named = movementNamePhrases(movement).some((phrase) =>
      phrase.includes(" ") ? haystack.includes(phrase) : tokens.has(phrase)
    );
    if (named) {
      issues.push(
        issue(
          "CONSTRAINT_VIOLATION",
          "critical",
          "visual_world",
          `The concept names "${movement.id}" but the direction selected "${chosenMovement}".`,
          "The design movement is decided by the deterministic engine from industry, audience and country fit. A concept that reassigns it is proposing a different project.",
          "Express the idea inside the assigned movement, or raise a revision of the direction instead."
        )
      );
      break;
    }
  }

  // Prohibitions are the client's own words and outrank anything proposed here.
  for (const constraint of contract.constraints) {
    if (constraint.kind !== "must_not" && constraint.kind !== "avoid") continue;
    const words = contentWords(constraint.statement, lexicon).filter((word) => word.length > 3);
    if (words.length === 0) continue;
    const hits = words.filter((word) => tokens.has(word)).length;
    if (hits / words.length >= 0.6) {
      issues.push(
        issue(
          "FORBIDDEN_DIRECTION",
          "critical",
          "visual_metaphor",
          `The concept appears to pursue something the brief prohibits: "${constraint.statement}".`,
          "A prohibition is stated by the client and cannot be overridden by a creative idea.",
          "Find an idea that achieves the same objective without the prohibited element."
        )
      );
      break;
    }
  }

  return issues;
}

/** ---------------------------------------------------------------- 7F culture */

/**
 * Cultural safety.
 *
 * Reuses the `avoid_stereotypes` guard already authored in the country files,
 * so there is one stereotype list in the system rather than two that drift.
 * Each country entry carries a `why` and an `instead`, which become the reason
 * and the fix — the rejection tells the model what to do next, not just no.
 */
function checkCulture(
  proposal: ConceptProposal,
  contract: DesignContract,
  datasets: DatasetRegistry,
  lexicon: ConceptLexicon
): ConceptIssue[] {
  const issues: ConceptIssue[] = [];
  const haystack = [
    ...CONCEPTUAL_FIELDS.map((field) => fieldText(proposal, field)),
    proposal.name
  ]
    .join(" ")
    .toLowerCase();

  const blendIds = new Set(Object.keys(contract.country));

  for (const [countryId, country] of datasets.countries) {
    for (const entry of country.avoid_stereotypes) {
      const token = entry.token.toLowerCase();
      if (!haystack.includes(token)) continue;

      // A token released by an explicit client mandate is already recorded on
      // the contract; anything still banned there is still banned here.
      const stillBanned = contract.banned_tokens.some(
        (banned) => banned.toLowerCase() === token
      );
      if (!stillBanned) continue;

      issues.push(
        issue(
          blendIds.has(countryId) ? "CULTURAL_STEREOTYPE" : "INVENTED_CULTURAL_CLAIM",
          "major",
          "visual_metaphor",
          blendIds.has(countryId)
            ? `"${entry.token}" is a stereotype shortcut for ${country.name}.`
            : `"${entry.token}" belongs to ${country.name}, which is not part of this brief's cultural blend.`,
          entry.why,
          entry.instead
        )
      );
    }
  }

  for (const pattern of lexicon.cultural_shortcut_patterns) {
    if (!haystack.includes(pattern.toLowerCase())) continue;
    issues.push(
      issue(
        "CULTURAL_STEREOTYPE",
        "major",
        "visual_world",
        `"${pattern}" treats a country as a single look.`,
        "Country influence in this system is spatial behaviour, material discipline and graphic rhythm. Reducing it to a decorative style is exactly the shortcut the country data exists to prevent.",
        "Express the influence through composition, materiality or rhythm rather than through motifs."
      )
    );
    break;
  }

  return issues;
}

/** ---------------------------------------------------------------- entry point */

export function validateConcept(
  proposal: ConceptProposal,
  contract: DesignContract,
  direction: DesignDirection,
  datasets: DatasetRegistry
): ConceptValidation {
  const lexicon = conceptLexicon(datasets);
  if (!lexicon) {
    return {
      issues: [
        issue(
          "SCHEMA_INVALID",
          "critical",
          "(root)",
          "The concept language lexicon is not loaded.",
          "Validation is data-driven and cannot run without it.",
          "Check that data/lexicons/concept-language.json is present and valid."
        )
      ],
      specificity: 0,
      passed: false
    };
  }

  const specificity = measureSpecificity(proposal, lexicon);
  const issues = [
    ...checkGenericLanguage(proposal, lexicon),
    ...checkSpecificity(specificity),
    ...checkConstraints(proposal, contract, direction, datasets, lexicon),
    ...checkCulture(proposal, contract, datasets, lexicon)
  ];

  return {
    issues,
    specificity: specificity.score,
    // Critical issues reject. Major issues reject too — a stereotype or a
    // constraint breach is not something to pass along with a note attached.
    passed: !issues.some((entry) => entry.severity === "critical" || entry.severity === "major")
  };
}
