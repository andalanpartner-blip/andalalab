import type { DatasetRegistry } from "../../types/datasets";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DesignDirection } from "../../types/schemas/direction.schema";
import type {
  ConceptIssue,
  ConceptProposal,
  CreativeConcept,
  DiversityVector
} from "../../types/schemas/concept.schema";
import {
  ConceptProposalBatch,
  CreativeConcept as CreativeConceptSchema
} from "../../types/schemas/concept.schema";
import { SCHEMA_VERSIONS } from "../../types/versions";
import { canonicalise, fnv1a } from "../../types/primitives";
import type { ClockPort } from "../../ports/clock.port";
import type { IdPort } from "../../ports/id.port";
import type { LlmCallMeta, LlmIssue, LlmPort } from "../../ports/llm.port";
import { llmIssue } from "../../ports/llm.port";
import { deepFreeze } from "../../domain/contract";
import { err, ok, type Result } from "../util/result";

import { CONCEPT_COUNT, CONCEPT_TEMPLATE_VERSION, MAX_CONCEPT_CALLS } from "./config";
import { buildConceptPrompt, buildRegenerationPrompt, CONCEPT_GENERATOR_SYSTEM } from "./prompts/concept-generator";
import { validateConcept } from "./validate";
import { assessDiversity, buildDiversityVector, type DiversityReport } from "./diversity";
import { scoreConcept } from "./score";

/**
 * The Creative Concept Engine.
 *
 * The model writes ideas. Everything that decides whether an idea counts —
 * validation, diversity, scoring, selection — is deterministic code in this
 * directory. The model is never told which concept won.
 *
 * Budget: one generation call, plus at most one targeted regeneration of the
 * concepts that failed. Never a third. Regenerating all three because one was
 * a duplicate would throw away work the engine already accepted.
 */

export type ConceptRejection = {
  readonly name: string;
  readonly issues: readonly ConceptIssue[];
};

export type ConceptGenerationOutcome = {
  readonly concepts: readonly CreativeConcept[];
  readonly selected: CreativeConcept;
  readonly rejected: readonly ConceptRejection[];
  readonly diversity: DiversityReport;
  readonly calls: number;
  readonly meta: readonly LlmCallMeta[];
};

export type GenerateConceptsInput = {
  readonly projectId: string;
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly datasets: DatasetRegistry;
  readonly llm: LlmPort;
  readonly ids: IdPort;
  readonly clock: ClockPort;
  readonly count?: number;
  readonly createdBy?: string;
};

type Accepted = {
  readonly proposal: ConceptProposal;
  readonly vector: DiversityVector;
  readonly specificity: number;
};

const summarise = (proposal: ConceptProposal): string =>
  `"${proposal.name}" (${proposal.type}, ${proposal.subject_strategy}): ${proposal.big_idea}`;

export async function generateConcepts(
  input: GenerateConceptsInput
): Promise<Result<ConceptGenerationOutcome, LlmIssue[] | ConceptIssue[]>> {
  const count = input.count ?? CONCEPT_COUNT;
  const basePrompt = buildConceptPrompt({
    contract: input.contract,
    direction: input.direction,
    datasets: input.datasets,
    count
  });

  const meta: LlmCallMeta[] = [];
  const rejected: ConceptRejection[] = [];
  let accepted: Accepted[] = [];
  let calls = 0;

  const validateAndKeep = (proposals: readonly ConceptProposal[]): void => {
    for (const proposal of proposals) {
      const validation = validateConcept(
        proposal,
        input.contract,
        input.direction,
        input.datasets
      );
      if (!validation.passed) {
        rejected.push({ name: proposal.name, issues: validation.issues });
        continue;
      }
      accepted.push({
        proposal,
        vector: buildDiversityVector(proposal, input.datasets),
        specificity: validation.specificity
      });
    }
  };

  // --- call 1 -------------------------------------------------------------
  const first = await input.llm.generateStructured(ConceptProposalBatch, basePrompt, {
    projectId: input.projectId,
    stage: "concept_generate",
    templateVersion: CONCEPT_TEMPLATE_VERSION,
    system: CONCEPT_GENERATOR_SYSTEM,
    maxOutputTokens: 4096
  });
  calls += 1;
  if (!first.ok) return err(first.error);
  meta.push(first.value.meta);
  validateAndKeep(first.value.value.concepts);

  // --- diversity ----------------------------------------------------------
  let diversity = assessDiversity(accepted.map((entry) => entry.vector));

  // Drop the echo of any near-duplicate pair, keeping the first statement.
  if (!diversity.passed && diversity.weakest_index !== null) {
    const index = diversity.weakest_index;
    const dropped = accepted[index];
    if (dropped) {
      rejected.push({
        name: dropped.proposal.name,
        issues: [
          {
            code: "NEAR_DUPLICATE",
            severity: "major",
            field: "big_idea",
            message: `"${dropped.proposal.name}" repeats an idea already proposed.`,
            reason:
              diversity.duplicates.find(
                (pair) => pair.a === index || pair.b === index
              )?.reason ?? "it scored below the diversity floor against another concept",
            fix: "Change what is shown, who is present, or how the story is told — not the styling."
          }
        ]
      });
      accepted = accepted.filter((_, position) => position !== index);
    }
  }

  const shortfall = count - accepted.length;

  // --- call 2, only if something is actually missing -----------------------
  if (shortfall > 0 && calls < MAX_CONCEPT_CALLS) {
    const prompt = buildRegenerationPrompt({
      basePrompt,
      keptSummaries: accepted.map((entry) => summarise(entry.proposal)),
      issues: rejected.flatMap((entry) => entry.issues),
      count: shortfall
    });

    const second = await input.llm.generateStructured(ConceptProposalBatch, prompt, {
      projectId: input.projectId,
      stage: "concept_generate",
      templateVersion: CONCEPT_TEMPLATE_VERSION,
      system: CONCEPT_GENERATOR_SYSTEM,
      maxOutputTokens: 4096
    });
    calls += 1;

    if (second.ok) {
      meta.push(second.value.meta);
      validateAndKeep(second.value.value.concepts);
      diversity = assessDiversity(accepted.map((entry) => entry.vector));

      // Anything still duplicated after the one allowed repair is dropped
      // rather than shipped. A duplicate concept is worse than a short list.
      while (!diversity.passed && diversity.weakest_index !== null) {
        const index: number = diversity.weakest_index;
        const dropped = accepted[index];
        if (!dropped) break;
        rejected.push({
          name: dropped.proposal.name,
          issues: [
            {
              code: "NEAR_DUPLICATE",
              severity: "major",
              field: "big_idea",
              message: `"${dropped.proposal.name}" still repeats another concept after regeneration.`,
              reason:
                diversity.duplicates.find((pair) => pair.a === index || pair.b === index)
                  ?.reason ?? "below the diversity floor",
              fix: "Needs a different subject or tension, not different styling."
            }
          ]
        });
        accepted = accepted.filter((_, position) => position !== index);
        diversity = assessDiversity(accepted.map((entry) => entry.vector));
      }
    }
  }

  if (accepted.length === 0) {
    return err([
      llmIssue(
        "repair_failed",
        `no concept survived validation after ${calls} call(s); ${rejected.length} were rejected`,
        calls
      )
    ]);
  }

  // --- deterministic scoring and selection ---------------------------------
  const vectors = accepted.map((entry) => entry.vector);
  const createdAt = input.clock.now().toISOString();

  const concepts: CreativeConcept[] = accepted.map((entry) => {
    const body = {
      project_id: input.projectId,
      schema_version: SCHEMA_VERSIONS.concept,
      dataset_version: input.datasets.version,
      created_by: input.createdBy ?? "llm",
      direction_id: input.direction.id,
      proposal: entry.proposal,
      diversity_vector: entry.vector,
      score: scoreConcept({
        proposal: entry.proposal,
        vector: entry.vector,
        siblings: vectors,
        specificity: entry.specificity,
        contract: input.contract,
        direction: input.direction,
        datasets: input.datasets
      })
    };

    return CreativeConceptSchema.parse({
      ...body,
      id: input.ids.next("concept"),
      created_at: createdAt,
      concept_hash: fnv1a(canonicalise(body))
    });
  });

  // Highest deterministic score wins; ties break on id so the result never
  // depends on the order the model happened to return them in.
  const ranked = [...concepts].sort((a, b) =>
    b.score.total === a.score.total ? a.id.localeCompare(b.id) : b.score.total - a.score.total
  );
  const selected = ranked[0];
  if (!selected) {
    return err([llmIssue("repair_failed", "no concept could be selected", calls)]);
  }

  return ok(
    deepFreeze({
      concepts: ranked,
      selected,
      rejected,
      diversity: assessDiversity(vectors),
      calls,
      meta
    })
  );
}
