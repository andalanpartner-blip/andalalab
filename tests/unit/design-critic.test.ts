import { describe, expect, it } from "vitest";
import { pipeline } from "../fixtures/load";
import { compilePromptSet } from "../../engine/prompt/compile";
import { auditDesign, MOVEMENT_INFLUENCE_FLOOR, type AuditInput } from "../../engine/critic/audit";
import { DesignCriticReport } from "../../types/schemas/design-critic.schema";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";

/**
 * The Design Critic (P4.0). Pure, deterministic, read-only. Every test builds a
 * real fixture design and mutates a copy to trip one check — no LLM, no image,
 * no clock, no network.
 */

const clean = pipeline("kopi-lawas-promotion"); // 0 conflicts, influence 1.0
const conflicted = pipeline("brutalist-trust-conflict"); // pinned movement, P0 conflict

function baseInput(source = clean): AuditInput {
  const promptSet = compilePromptSet({ recipe: source.recipe, language: "en" });
  return {
    contract: source.contract,
    direction: source.direction,
    recipe: source.recipe,
    promptSet,
    promptLanguage: "en",
    concept: null
  };
}

/** A deep, unfrozen clone whose recipe can be mutated. */
function withRecipe(mutate: (r: DesignRecipe) => void, source = clean): AuditInput {
  const input = baseInput(source);
  const recipe = structuredClone(input.recipe) as DesignRecipe;
  mutate(recipe);
  const promptSet = compilePromptSet({ recipe, language: "en" });
  return { ...input, recipe, promptSet };
}

const fakeConcept = (over: Partial<CreativeConcept> = {}): CreativeConcept =>
  ({
    id: "concept_x",
    direction_id: clean.direction.id,
    concept_hash: "abcd1234",
    ...over
  }) as unknown as CreativeConcept;

describe("auditDesign: a clean design", () => {
  it("PASSes, is schema-valid, and is deterministic", () => {
    const a = auditDesign(baseInput());
    const b = auditDesign(baseInput());
    expect(DesignCriticReport.safeParse(a).success).toBe(true);
    expect(a.verdict).toBe("PASS");
    expect(a.findings).toEqual([]);
    expect(a.checks_run).toBe(9);
    expect(a.audited.recipe_hash).toBe(clean.recipe.recipe_hash);
    expect(b).toEqual(a);
  });

  it("populates the audited traceability block without re-deriving anything", () => {
    const r = auditDesign(baseInput());
    expect(r.audited).toEqual({
      contract_id: clean.contract.id,
      direction_id: clean.direction.id,
      recipe_id: clean.recipe.id,
      recipe_hash: clean.recipe.recipe_hash,
      prompt_language: "en",
      concept_ref: clean.recipe.concept_ref
    });
  });
});

describe("auditDesign: integrity checks (a corrupted artifact BLOCKs)", () => {
  it("BLOCKs when a resolved DKV value no longer matches the direction", () => {
    const r = auditDesign(withRecipe((recipe) => {
      recipe.dkv.contrast = Math.min(1, recipe.dkv.contrast + 0.2);
    }));
    expect(r.verdict).toBe("BLOCK");
    expect(r.findings.some((f) => f.check === "dkv-consistency" && f.severity === "P0")).toBe(true);
  });

  it("BLOCKs when a DKV value is outside its absolute limit", () => {
    const r = auditDesign(withRecipe((recipe) => {
      recipe.dkv.whitespace = 1.5;
    }));
    expect(r.verdict).toBe("BLOCK");
    expect(r.findings.some((f) => f.check === "dkv-limits")).toBe(true);
  });

  it("BLOCKs when the recipe points at a different contract", () => {
    const r = auditDesign(withRecipe((recipe) => {
      recipe.contract_id = "contract_wrong";
    }));
    expect(r.verdict).toBe("BLOCK");
    expect(r.findings.some((f) => f.check === "linkage-recipe-contract")).toBe(true);
  });

  it("BLOCKs on objective drift", () => {
    const r = auditDesign(withRecipe((recipe) => {
      recipe.objective = "trust";
    }));
    expect(r.findings.some((f) => f.check === "objective-drift" && f.severity === "P0")).toBe(true);
  });

  it("BLOCKs on core-message drift", () => {
    const r = auditDesign(withRecipe((recipe) => {
      recipe.core_message = "A completely different core message than the contract carries.";
    }));
    expect(r.findings.some((f) => f.check === "core-message-drift")).toBe(true);
  });

  it("BLOCKs when a locked anchor moved", () => {
    const r = auditDesign(withRecipe((recipe) => {
      recipe.anchors = recipe.anchors.map((a) =>
        a.kind === "objective" ? { ...a, value: "tampered" } : a
      );
    }));
    expect(r.verdict).toBe("BLOCK");
    expect(r.findings.some((f) => f.check === "anchor-integrity")).toBe(true);
  });

  it("BLOCKs when the recipe never locked the primary visual direction anchor", () => {
    const r = auditDesign(withRecipe((recipe) => {
      recipe.anchors = recipe.anchors.map((a) =>
        a.kind === "primary_visual_direction" ? { ...a, status: "pending" as const } : a
      );
    }));
    expect(r.findings.some((f) => f.check === "anchor-direction-unlocked")).toBe(true);
  });
});

describe("auditDesign: DKV conflicts map to the pipeline's own severity", () => {
  it("a P0 conflict (pinned movement vs industry) → BLOCK, and the param is named", () => {
    const r = auditDesign(baseInput(conflicted));
    expect(r.verdict).toBe("BLOCK");
    const p0 = r.findings.find((f) => f.check === "dkv-conflict" && f.severity === "P0");
    expect(p0).toBeDefined();
    expect(p0!.message).toContain("visual_density");
    expect(p0!.evidence.join(" ")).toMatch(/visual_density/);
  });

  it("a P1 conflict → REVIEW, never BLOCK on its own", () => {
    const r = auditDesign(baseInput(pipeline("northbeam-saas-launch")));
    expect(r.verdict).toBe("REVIEW");
    expect(r.findings.every((f) => f.severity !== "P0")).toBe(true);
    expect(r.findings.some((f) => f.check === "dkv-conflict" && f.severity === "P1")).toBe(true);
  });

  it("a P2-only conflict → PASS with the note listed", () => {
    const r = auditDesign(baseInput(pipeline("luxury-density-conflict")));
    expect(r.verdict).toBe("PASS");
    expect(r.findings.some((f) => f.severity === "P2")).toBe(true);
  });
});

describe("auditDesign: design-quality checks", () => {
  it("flags a movement that barely survived doctrine (REVIEW)", () => {
    const r = auditDesign(withRecipe((recipe) => {
      recipe.movement.influence = MOVEMENT_INFLUENCE_FLOOR - 0.2;
    }));
    expect(r.verdict).toBe("REVIEW");
    expect(r.findings.some((f) => f.check === "movement-influence" && f.area === "movement")).toBe(true);
  });

  it("flags high artificiality risk against a photoreal target (BLOCK)", () => {
    const r = auditDesign(withRecipe((recipe) => {
      recipe.photographic_character.realism_target = "photoreal-natural";
      recipe.photographic_character.artificiality_risk = {
        ...recipe.photographic_character.artificiality_risk,
        score: 82,
        band: "high"
      };
    }));
    expect(r.findings.some((f) => f.check === "artificiality-vs-target" && f.severity === "P0")).toBe(true);
  });

  it("elevated artificiality against a photoreal target is REVIEW, not BLOCK", () => {
    const r = auditDesign(withRecipe((recipe) => {
      recipe.photographic_character.realism_target = "photoreal-refined";
      recipe.photographic_character.artificiality_risk = {
        ...recipe.photographic_character.artificiality_risk,
        score: 60,
        band: "elevated"
      };
    }));
    const finding = r.findings.find((f) => f.check === "artificiality-vs-target");
    expect(finding?.severity).toBe("P1");
  });

  it("does not flag artificiality when the target is deliberately stylised", () => {
    const r = auditDesign(withRecipe((recipe) => {
      recipe.photographic_character.realism_target = "stylised-photographic";
      recipe.photographic_character.artificiality_risk = {
        ...recipe.photographic_character.artificiality_risk,
        score: 82,
        band: "high"
      };
    }));
    expect(r.findings.some((f) => f.check === "artificiality-vs-target")).toBe(false);
  });

  it("BLOCKs when a required constraint is absent from every compiled prompt", () => {
    const input = baseInput();
    const recipe = structuredClone(input.recipe) as DesignRecipe;
    recipe.constraints = [
      ...recipe.constraints,
      {
        id: "test-missing-must",
        source: "brief",
        kind: "must",
        statement: "This unique required sentence is deliberately never rendered anywhere.",
        doctrine_rank: 1
      }
    ];
    // Compile from the ORIGINAL recipe so the new constraint is genuinely absent.
    const r = auditDesign({ ...input, recipe });
    expect(r.findings.some((f) => f.check === "constraint-coverage" && f.severity === "P0")).toBe(true);
  });

  it("BLOCKs a TEXT_CRITICAL recipe whose core message is missing from the Master Prompt", () => {
    const input = baseInput();
    const promptSet = {
      ...input.promptSet,
      masterPrompt: input.promptSet.masterPrompt.split(input.recipe.core_message).join("[redacted]")
    };
    const r = auditDesign({ ...input, promptSet });
    // kopi-lawas is TEXT_CRITICAL (required headline zone + core message).
    expect(r.findings.some((f) => f.check === "core-message-rendering")).toBe(true);
  });
});

describe("auditDesign: stereotype-guard rollup", () => {
  const withGuard = (findings: AuditInput["promptSet"]["guard"]["findings"]): AuditInput => {
    const input = baseInput();
    return { ...input, promptSet: { ...input.promptSet, guard: { clean: findings.length === 0, findings } } };
  };

  it("a stripped motif → REVIEW", () => {
    const r = auditDesign(withGuard([
      { token: "batik", tier: "masterPrompt", action: "stripped", negative_context: false, context: "batik" }
    ]));
    expect(r.verdict).toBe("REVIEW");
    expect(r.findings.some((f) => f.area === "stereotype-guard" && f.severity === "P1")).toBe(true);
  });

  it("a motif flagged in POSITIVE prose → REVIEW", () => {
    const r = auditDesign(withGuard([
      { token: "batik", tier: "masterPrompt", action: "flagged", negative_context: false, context: "a batik-lined room" }
    ]));
    expect(r.findings.some((f) => f.area === "stereotype-guard" && f.severity === "P1")).toBe(true);
  });

  it("a motif flagged inside an avoid instruction → P2 note only, verdict PASS", () => {
    const r = auditDesign(withGuard([
      { token: "batik", tier: "negativePrompt", action: "flagged", negative_context: true, context: "No batik pattern" }
    ]));
    expect(r.verdict).toBe("PASS");
    expect(r.findings.some((f) => f.area === "stereotype-guard" && f.severity === "P2")).toBe(true);
  });
});

describe("auditDesign: concept linkage", () => {
  it("BLOCKs when the supplied concept id does not match recipe.concept_ref", () => {
    const r = auditDesign({ ...baseInput(), concept: fakeConcept({ id: "concept_other" }) });
    expect(r.findings.some((f) => f.check === "linkage-concept" && f.area === "concept")).toBe(true);
  });

  it("BLOCKs when the concept was generated for a different direction", () => {
    const r = auditDesign({
      ...baseInput(),
      concept: fakeConcept({ id: clean.recipe.concept_ref ?? "concept_x", direction_id: "direction_other" })
    });
    expect(r.findings.some((f) => f.check === "concept-direction-drift")).toBe(true);
  });
});

describe("auditDesign: verdict rollup", () => {
  it("P0 + P1 present → BLOCK", () => {
    const r = auditDesign(baseInput(conflicted));
    expect(r.findings.some((f) => f.severity === "P0")).toBe(true);
    expect(r.findings.some((f) => f.severity === "P1")).toBe(true);
    expect(r.verdict).toBe("BLOCK");
  });

  it("orders findings most-severe first", () => {
    const r = auditDesign(baseInput(conflicted));
    const severities = r.findings.map((f) => f.severity);
    const sorted = [...severities].sort((a, b) => ({ P0: 0, P1: 1, P2: 2 })[a] - ({ P0: 0, P1: 1, P2: 2 })[b]);
    expect(severities).toEqual(sorted);
  });
});
