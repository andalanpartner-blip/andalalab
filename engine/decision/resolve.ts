import type { DatasetRegistry } from "../../types/datasets";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type {
  Conflict,
  DesignDirection,
  Resolution,
  ScoredCandidate
} from "../../types/schemas/direction.schema";
import { DesignDirection as DesignDirectionSchema } from "../../types/schemas/direction.schema";
import { SCHEMA_VERSIONS } from "../../types/versions";
import { canonicalise, fnv1a } from "../../types/primitives";
import type { DirectionIssue } from "../../domain/errors";
import { directionIssue } from "../../domain/errors";
import { deepFreeze } from "../../domain/contract";
import type { ClockPort } from "../../ports/clock.port";
import type { IdPort } from "../../ports/id.port";

import { err, ok, type Result } from "../util/result";
import { resolveDkv } from "../dkv/rules";
import { normaliseBlend, type ResolvedCountry } from "../country/blend";
import { generateCandidates } from "./candidates";
import { scoreCandidates, SCORING_VERSION } from "./score";
import { collectClaims } from "./conflicts";
import { buildRationale, explainRejection } from "./explain";

export type BuildDirectionInput = {
  readonly projectId: string;
  readonly contract: DesignContract;
  readonly datasets: DatasetRegistry;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly createdBy?: string;
};

/**
 * Build the Design Direction.
 *
 * Candidates are evaluated in score order. The first one whose conflicts can
 * all be resolved without a P0 wins; anything with an unresolvable P0 is
 * rejected and the next candidate is tried (P1 spec §8).
 *
 * One deliberate exception: if the brief PINNED a movement, a P0 does not
 * reject it. A pinned movement is a rank-1 instruction from the client, and
 * the right response is to keep it and constrain it loudly — not to silently
 * substitute a movement they did not ask for. The resolution log carries the
 * damage report either way.
 */
export function buildDesignDirection(
  input: BuildDirectionInput
): Result<DesignDirection, DirectionIssue[]> {
  const { contract, datasets } = input;

  const countries: ResolvedCountry[] = Object.entries(normaliseBlend(contract.country))
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([id, weight]) => {
      const country = datasets.countries.get(id);
      return country ? [{ country, weight }] : [];
    });

  const generated = generateCandidates(contract, datasets, countries);
  if (generated.candidates.length === 0) {
    return err([
      directionIssue(
        "no_candidates",
        "candidates",
        `no movement/layout pair survived filtering for industry "${contract.industry.id}" and visual type "${contract.visual_type.id}"`
      )
    ]);
  }

  const scored = scoreCandidates(generated.candidates, contract, datasets, countries);
  const pinned = contract.movement !== null;

  let selected: ScoredCandidate | null = null;
  let conflicts: Conflict[] = [];
  let resolutions: Resolution[] = [];
  let derivations: ReturnType<typeof resolveDkv>["derivations"] = [];
  let params: ReturnType<typeof resolveDkv>["params"] | null = null;

  const rejected: { candidate_id: string; reason: string; severity: "P0" | "P1" | "P2" }[] = [];
  const rejectionLines: string[] = [];

  for (const candidate of scored) {
    const claims = collectClaims(contract, candidate.candidate, datasets);
    const resolvedDkv = resolveDkv(claims);
    const critical = resolvedDkv.conflicts.filter((conflict) => conflict.severity === "P0");

    if (critical.length > 0 && !pinned) {
      const reason = `${critical.length} unresolvable P0 conflict(s): ${critical
        .map((conflict) => conflict.param)
        .join(", ")}. Satisfying the higher-ranked layer would leave nothing of the movement.`;
      rejected.push({
        candidate_id: candidate.candidate.candidate_id,
        reason,
        severity: "P0"
      });
      rejectionLines.push(explainRejection(candidate, reason));
      continue;
    }

    selected = candidate;
    conflicts = resolvedDkv.conflicts;
    resolutions = resolvedDkv.resolutions;
    derivations = resolvedDkv.derivations;
    params = resolvedDkv.params;
    break;
  }

  if (!selected || !params) {
    return err([
      directionIssue(
        "no_viable_candidate",
        "candidates",
        `all ${scored.length} candidate(s) carried unresolvable P0 conflicts: ${rejected
          .map((entry) => `${entry.candidate_id} (${entry.reason})`)
          .join("; ")}`
      )
    ]);
  }

  const runnerUp = scored.find(
    (candidate) => candidate.candidate.candidate_id !== selected?.candidate.candidate_id
  );

  const body = {
    project_id: input.projectId,
    schema_version: SCHEMA_VERSIONS.direction,
    dataset_version: datasets.version,
    created_by: input.createdBy ?? "system",
    contract_id: contract.id,
    contract_hash: contract.contract_hash,
    scoring_version: SCORING_VERSION,
    candidates: scored,
    rejected,
    selected_candidate_id: selected.candidate.candidate_id,
    dkv_targets: params,
    derivations,
    conflicts,
    resolutions,
    rationale: buildRationale({
      selected,
      runnerUp: runnerUp ?? null,
      rejections: rejectionLines,
      resolutions,
      derivations,
      relaxations: generated.relaxations
    })
  };

  const direction = {
    ...body,
    id: input.ids.next("direction"),
    created_at: input.clock.now().toISOString(),
    direction_hash: fnv1a(canonicalise(body))
  };

  const validated = DesignDirectionSchema.safeParse(direction);
  if (!validated.success) {
    return err(
      validated.error.issues.map((problem) =>
        directionIssue("direction_invalid", problem.path.join(".") || "(root)", problem.message)
      )
    );
  }

  return ok(deepFreeze(validated.data));
}

/** The scored candidate that was selected, for downstream consumers. */
export function selectedCandidate(direction: DesignDirection): ScoredCandidate {
  const found = direction.candidates.find(
    (candidate) => candidate.candidate.candidate_id === direction.selected_candidate_id
  );
  if (!found) throw new Error(`direction ${direction.id} has no candidate matching its selection`);
  return found;
}
