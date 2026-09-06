import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DesignDirection } from "../../types/schemas/direction.schema";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type {
  CriticFinding,
  CriticSeverity,
  DesignCriticReport
} from "../../types/schemas/design-critic.schema";
export type {
  DesignCriticReport,
  CriticFinding,
  CriticVerdict,
  CriticSeverity,
  CriticArea
} from "../../types/schemas/design-critic.schema";
import { DKV_PARAM_KEYS } from "../../types/schemas/dkv.schema";
import { PARAM_LIMITS } from "../dkv/rules";
import { anchorViolations } from "../recipe/anchors";
import { isUnsupportedConceptStatement } from "../prompt/unsupported-concepts";
import { resolveTextMode } from "../prompt/text-mode";

/**
 * The Design Critic (P4.0) — a deterministic, read-only audit of a finished
 * design.
 *
 * It never calls a model, touches an image, hits the network, or mutates the
 * contract / direction / recipe / prompt set. Every check is arithmetic or a
 * string comparison over values the pipeline already resolved. Identical inputs
 * always produce an identical `DesignCriticReport`.
 *
 * Severity mapping (the pipeline's own P0/P1/P2 scale, reused):
 *   P0 finding ⇒ verdict BLOCK
 *   P1 finding ⇒ verdict REVIEW
 *   P2 finding ⇒ informational only (listed, never changes the verdict)
 *
 * See `docs/design-critic.md`.
 */

/** The compiled prompt strings the critic reads. Matches `PromptSet`'s tiers + guard. */
export type AuditPromptSet = {
  readonly masterPrompt: string;
  readonly quickPrompt: string;
  readonly imageOnlyPrompt: string;
  readonly designLayoutPrompt: string;
  readonly negativePrompt: string;
  readonly guard: {
    readonly clean: boolean;
    readonly findings: readonly {
      readonly token: string;
      readonly tier: string;
      readonly action: "stripped" | "flagged";
      readonly negative_context: boolean;
      readonly context: string;
    }[];
  };
};

export type AuditInput = {
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly recipe: DesignRecipe;
  readonly promptSet: AuditPromptSet;
  readonly promptLanguage: string;
  readonly concept?: CreativeConcept | null;
};

/** Movement influence below this is a client stylistic pin that barely survived doctrine. */
export const MOVEMENT_INFLUENCE_FLOOR = 0.5;
/** How many leading characters of a `must` statement must appear somewhere in a prompt. */
const CONSTRAINT_FRAGMENT_LEN = 28;

type Draft = Omit<CriticFinding, "evidence"> & { evidence: string[] };

class Findings {
  private readonly list: Draft[] = [];

  add(
    severity: CriticSeverity,
    check: string,
    area: CriticFinding["area"],
    message: string,
    evidence: readonly string[] = []
  ): void {
    this.list.push({ severity, check, area, message, evidence: [...evidence] });
  }

  finalize(): CriticFinding[] {
    const rank: Record<CriticSeverity, number> = { P0: 0, P1: 1, P2: 2 };
    return [...this.list]
      .sort(
        (a, b) =>
          rank[a.severity] - rank[b.severity] ||
          a.check.localeCompare(b.check) ||
          a.message.localeCompare(b.message)
      )
      .map((d) => ({ ...d, evidence: [...d.evidence] }));
  }
}

const norm = (value: string): string => value.replace(/\s+/g, " ").trim();
const pct = (value: number): string => `${Math.round(value * 100)}%`;

// --- individual checks ---------------------------------------------------

/** Every resolved DKV value equals its derivation, sits in its band, and inside absolute limits. */
function checkDkvConsistency(input: AuditInput, f: Findings): void {
  const byParam = new Map(input.direction.derivations.map((d) => [d.param, d]));

  for (const param of DKV_PARAM_KEYS) {
    const value = input.recipe.dkv[param];
    const limit = PARAM_LIMITS[param];
    const derivation = byParam.get(param);

    if (value < limit.min - 1e-9 || value > limit.max + 1e-9) {
      f.add("P0", "dkv-limits", "integrity", `Resolved ${param} ${value} is outside its absolute limit [${limit.min}, ${limit.max}].`, [
        `${param}=${value}`
      ]);
    }

    if (!derivation) {
      f.add("P0", "dkv-derivation-missing", "integrity", `The direction has no DKV derivation for ${param}.`, [param]);
      continue;
    }

    if (Math.abs(value - derivation.final) > 1e-9) {
      f.add("P0", "dkv-consistency", "integrity", `Recipe ${param} (${value}) does not match the direction's resolved value (${derivation.final}) — the recipe has been altered.`, [
        `${param}: recipe=${value} direction=${derivation.final}`
      ]);
    }

    const { min, max } = derivation.clamped_to;
    if (derivation.final < min - 1e-9 || derivation.final > max + 1e-9) {
      f.add("P0", "dkv-band", "integrity", `Resolved ${param} ${derivation.final} fell outside the band [${min}, ${max}] it was clamped to.`, [
        `${param}=${derivation.final} band=[${min},${max}]`
      ]);
    }
  }
}

/** Artifact ids link up, and the objective / core message survived unchanged. */
function checkLinkage(input: AuditInput, f: Findings): void {
  const { contract, direction, recipe, concept } = input;

  if (direction.contract_id !== contract.id) {
    f.add("P0", "linkage-direction", "integrity", `The direction was built for contract ${direction.contract_id}, not ${contract.id}.`, [
      `${direction.contract_id} vs ${contract.id}`
    ]);
  }
  if (recipe.contract_id !== contract.id) {
    f.add("P0", "linkage-recipe-contract", "integrity", `The recipe references contract ${recipe.contract_id}, not ${contract.id}.`, [
      `${recipe.contract_id} vs ${contract.id}`
    ]);
  }
  if (recipe.direction_id !== direction.id) {
    f.add("P0", "linkage-recipe-direction", "integrity", `The recipe references direction ${recipe.direction_id}, not ${direction.id}.`, [
      `${recipe.direction_id} vs ${direction.id}`
    ]);
  }
  if (recipe.objective !== contract.objective) {
    f.add("P0", "objective-drift", "integrity", `The recipe objective "${recipe.objective}" differs from the contract objective "${contract.objective}".`, [
      `${recipe.objective} vs ${contract.objective}`
    ]);
  }
  if (norm(recipe.core_message) !== norm(contract.core_message)) {
    f.add("P0", "core-message-drift", "integrity", "The recipe core message differs from the contract core message.", [
      recipe.core_message,
      contract.core_message
    ]);
  }
  if (concept && recipe.concept_ref !== concept.id) {
    f.add("P0", "linkage-concept", "concept", `The recipe references concept ${recipe.concept_ref}, not the supplied ${concept.id}.`, [
      `${recipe.concept_ref} vs ${concept.id}`
    ]);
  }
  if (concept && concept.direction_id !== direction.id) {
    // A P6 correction re-resolves the contract and regenerates the direction
    // with a fresh id. On a derived recipe whose concept_ref still points at
    // this concept, that id mismatch is regeneration, not drift — the concept
    // content itself is still pinned by the concept_ref check above and by the
    // concept anchor check in checkAnchors. Keep the strict check for original
    // (non-derived) recipes.
    const regeneratedByCorrection = recipe.derived_from !== null && recipe.concept_ref === concept.id;
    if (!regeneratedByCorrection) {
      f.add("P0", "concept-direction-drift", "concept", `The concept was generated for direction ${concept.direction_id}, not ${direction.id}.`, [
        `${concept.direction_id} vs ${direction.id}`
      ]);
    }
  }
}

/** Locked anchors are unchanged and still locked; the recipe locked its own two. */
function checkAnchors(input: AuditInput, f: Findings): void {
  const violations = anchorViolations(input.contract.anchors, input.recipe.anchors);
  for (const violation of violations) {
    f.add("P0", "anchor-integrity", "integrity", `A locked anchor moved: ${violation}.`, [violation]);
  }

  const byKind = new Map(input.recipe.anchors.map((a) => [a.kind, a]));

  const direction = byKind.get("primary_visual_direction");
  if (!direction || direction.status !== "locked") {
    f.add("P0", "anchor-direction-unlocked", "integrity", "The recipe did not lock the primary visual direction anchor.", [
      `status=${direction?.status ?? "missing"}`
    ]);
  }

  if (input.concept) {
    const conceptAnchor = byKind.get("concept");
    const expected = `${input.concept.id}@${input.concept.concept_hash}`;
    if (!conceptAnchor || conceptAnchor.status !== "locked") {
      f.add("P0", "anchor-concept-unlocked", "concept", "A concept was supplied but the concept anchor is not locked.", [
        `status=${conceptAnchor?.status ?? "missing"}`
      ]);
    } else if (conceptAnchor.value !== expected) {
      f.add("P0", "anchor-concept-mismatch", "concept", `The concept anchor "${conceptAnchor.value}" does not match the supplied concept ("${expected}").`, [
        conceptAnchor.value,
        expected
      ]);
    }
  }
}

/** Surviving DKV conflicts: P0 blocks, P1 needs review, P2 is noted. */
function checkConflicts(input: AuditInput, f: Findings): void {
  const resolutionByConflict = new Map(input.direction.resolutions.map((r) => [r.conflict_id, r]));

  for (const conflict of input.direction.conflicts) {
    const resolution = resolutionByConflict.get(conflict.conflict_id);
    const detail = resolution
      ? ` ${resolution.winner} kept; ${resolution.loser} moved from ${resolution.requested} to ${resolution.resolved}.`
      : "";
    const evidence = [
      `${conflict.param} (${conflict.severity})`,
      ...(resolution ? [`requested ${resolution.requested} → resolved ${resolution.resolved}`] : [])
    ];

    if (conflict.severity === "P0") {
      f.add("P0", "dkv-conflict", "dkv", `Critical DKV conflict on ${conflict.param}: ${conflict.description}${detail}`, evidence);
    } else if (conflict.severity === "P1") {
      f.add("P1", "dkv-conflict", "dkv", `Major DKV conflict on ${conflict.param}: ${conflict.description}${detail}`, evidence);
    } else {
      f.add("P2", "dkv-conflict", "dkv", `Routine DKV adjustment on ${conflict.param}: ${conflict.description}${detail}`, evidence);
    }
  }
}

/** A movement the client pinned but that doctrine almost entirely overruled. */
function checkMovementInfluence(input: AuditInput, f: Findings): void {
  const influence = input.recipe.movement.influence;
  if (influence < MOVEMENT_INFLUENCE_FLOOR) {
    f.add(
      "P1",
      "movement-influence",
      "movement",
      `Only ${pct(influence)} of the ${input.recipe.movement.name} movement survived doctrine resolution — higher-authority layers overruled most of it. Confirm the resulting direction is still what the client wanted.`,
      [`influence=${influence}`]
    );
  }
}

/** Artificiality risk that contradicts the recipe's own realism target. */
function checkArtificiality(input: AuditInput, f: Findings): void {
  const pc = input.recipe.photographic_character;
  const photorealTarget = pc.realism_target === "photoreal-natural" || pc.realism_target === "photoreal-refined";
  if (!photorealTarget) return; // stylised / graphic targets expect a higher risk

  const band = pc.artificiality_risk.band;
  const evidence = [
    `artificiality ${pc.artificiality_risk.score}/100 (${band})`,
    `realism target ${pc.realism_target}`,
    ...pc.artificiality_risk.factors.slice(0, 3)
  ];

  if (band === "high") {
    f.add("P0", "artificiality-vs-target", "photographic", `The recipe aims for ${pc.realism_target} but its own optical choices push artificiality risk to ${band} (${pc.artificiality_risk.score}/100). The image is likely to read as synthetic.`, evidence);
  } else if (band === "elevated") {
    f.add("P1", "artificiality-vs-target", "photographic", `The recipe aims for ${pc.realism_target} but artificiality risk is ${band} (${pc.artificiality_risk.score}/100). Sanity-check depth of field, saturation and dynamic range before generating.`, evidence);
  }
}

/** The stereotype output guard's findings, rolled up. */
function checkStereotypeGuard(input: AuditInput, f: Findings): void {
  const findings = input.promptSet.guard.findings;
  if (findings.length === 0) return;

  const stripped = [...new Set(findings.filter((g) => g.action === "stripped").map((g) => g.token))];
  const positiveFlags = [...new Set(findings.filter((g) => g.action === "flagged" && !g.negative_context).map((g) => g.token))];
  const negativeFlags = [...new Set(findings.filter((g) => g.action === "flagged" && g.negative_context).map((g) => g.token))];

  if (positiveFlags.length > 0) {
    f.add("P1", "stereotype-guard", "stereotype-guard", `A guarded stereotype motif (${positiveFlags.join(", ")}) survived into positive prompt prose and could not be safely removed. Edit the source (concept, movement or imagery prose) before generating.`, positiveFlags);
  }
  if (stripped.length > 0) {
    f.add("P1", "stereotype-guard", "stereotype-guard", `A guarded stereotype motif (${stripped.join(", ")}) was removed from a positive list in the prompt. Confirm the intended imagery still reads without it.`, stripped);
  }
  if (negativeFlags.length > 0) {
    f.add("P2", "stereotype-guard", "stereotype-guard", `A guarded motif (${negativeFlags.join(", ")}) appears inside an "avoid / no" instruction — the prompt is correctly telling the generator not to use it.`, negativeFlags);
  }
}

/** Every renderable required constraint actually reached a compiled prompt. */
function checkConstraintCoverage(input: AuditInput, f: Findings): void {
  const tiers = [
    input.promptSet.masterPrompt,
    input.promptSet.quickPrompt,
    input.promptSet.imageOnlyPrompt,
    input.promptSet.designLayoutPrompt,
    input.promptSet.negativePrompt
  ].map(norm);
  const negative = norm(input.promptSet.negativePrompt);

  for (const constraint of input.recipe.constraints) {
    // Country-sourced negatives are deliberately compacted into one line, and
    // unsupported-concept statements are deliberately dropped — neither is a gap.
    if (constraint.source === "country") continue;
    if (isUnsupportedConceptStatement(constraint.statement)) continue;

    const fragment = norm(constraint.statement).slice(0, CONSTRAINT_FRAGMENT_LEN);
    if (fragment.length === 0) continue;

    if (constraint.kind === "must") {
      if (!tiers.some((tier) => tier.includes(fragment))) {
        f.add("P0", "constraint-coverage", "prompt-coverage", `Required constraint "${norm(constraint.statement)}" (${constraint.source}) does not appear in any compiled prompt.`, [
          constraint.id,
          fragment
        ]);
      }
    } else if (constraint.kind === "must_not") {
      const body = norm(constraint.statement).replace(/\.$/, "");
      if (!negative.includes(body) && !tiers.some((tier) => tier.includes(fragment))) {
        f.add("P1", "constraint-coverage", "prompt-coverage", `Prohibition "${norm(constraint.statement)}" (${constraint.source}) does not appear in the negative prompt.`, [
          constraint.id,
          fragment
        ]);
      }
    }
  }
}

/** TEXT_CRITICAL: the exact core message must be quoted in the master prompt. */
function checkCoreMessageRendering(input: AuditInput, f: Findings): void {
  if (resolveTextMode(input.recipe) !== "TEXT_CRITICAL") return;
  const message = norm(input.recipe.core_message);
  if (!norm(input.promptSet.masterPrompt).includes(message)) {
    f.add("P0", "core-message-rendering", "prompt-coverage", "The recipe is TEXT_CRITICAL but the exact core message is not quoted in the Master Prompt.", [message]);
  }
}

// --- public entry point ------------------------------------------------

const CHECKS: ((input: AuditInput, f: Findings) => void)[] = [
  checkDkvConsistency,
  checkLinkage,
  checkAnchors,
  checkConflicts,
  checkMovementInfluence,
  checkArtificiality,
  checkStereotypeGuard,
  checkConstraintCoverage,
  checkCoreMessageRendering
];

export function auditDesign(input: AuditInput): DesignCriticReport {
  const findingsCollector = new Findings();
  for (const check of CHECKS) check(input, findingsCollector);
  const findings = findingsCollector.finalize();

  const blocking = findings.filter((finding) => finding.severity === "P0").length;
  const review = findings.filter((finding) => finding.severity === "P1").length;
  const informational = findings.filter((finding) => finding.severity === "P2").length;

  const verdict = blocking > 0 ? "BLOCK" : review > 0 ? "REVIEW" : "PASS";

  const noun = (n: number, singular: string): string => (n === 1 ? `1 ${singular}` : `${n} ${singular}s`);
  const summary =
    verdict === "PASS"
      ? informational > 0
        ? `No design-quality issue found; ${noun(informational, "routine note")}.`
        : "No design-quality issue found — clear to generate."
      : verdict === "REVIEW"
        ? `${noun(review, "issue")} to review before generating${informational > 0 ? `; ${noun(informational, "routine note")}` : ""}.`
        : `${noun(blocking, "critical violation")} — the recipe is not ready to generate${review > 0 ? `; ${noun(review, "further issue")} to review` : ""}.`;

  return {
    verdict,
    summary,
    checks_run: CHECKS.length,
    findings,
    audited: {
      contract_id: input.contract.id,
      direction_id: input.direction.id,
      recipe_id: input.recipe.id,
      recipe_hash: input.recipe.recipe_hash,
      prompt_language: input.promptLanguage,
      concept_ref: input.recipe.concept_ref
    }
  };
}
