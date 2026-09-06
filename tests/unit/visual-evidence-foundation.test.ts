import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clock, datasets, newIds } from "../fixtures/load";
import { blueprintInputs } from "../fixtures/blueprint-inputs";
import { loadObservationPayload } from "../fixtures/visual-evidence-report/load";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { runVisualGeneration, type GenerationServiceDeps } from "../../services/generation.service";
import { createFakeVisualGeneration, FAKE_PLACEHOLDER_PNG_BASE64 } from "../../adapters/visual-generation/fake";
import { createReplayVisualEvidence, SYNTHETIC_OBSERVATION_PAYLOAD } from "../../adapters/visual-evidence/replay";
import { createVisualEvidenceClient } from "../../adapters/visual-evidence/client";
import { createGeminiVisualEvidence } from "../../adapters/visual-evidence/gemini-vision";
import { runVisualEvidence, getEvidenceDeps } from "../../services/evidence.service";
import { VisualEvidenceReport } from "../../types/schemas/visual-evidence-report.schema";
import { createCostLedger } from "../../services/cost.service";
import type { RawVisionCall } from "../../ports/visual-evidence.port";

/**
 * P2.14 — Visual Evidence Foundation.
 *
 * A structured OBSERVATION of one generated image. It carries no judgment: no
 * score, no verdict, no recommendation, no approval. Every value is an
 * observation or a piece of provenance copied from the artifact.
 */

const IMAGE_BYTES = new Uint8Array(Buffer.from(FAKE_PLACEHOLDER_PNG_BASE64, "base64"));

function scaffold(name = "kopi-lawas-promotion") {
  const i = blueprintInputs(name);
  const bp = resolveLayoutBlueprint({ recipe: i.recipe, contract: i.contract, direction: i.direction, datasets });
  if (!bp.ok) throw new Error("blueprint did not resolve");
  return { ...i, blueprint: bp.value };
}

const genDeps = (): GenerationServiceDeps => {
  const ledger = createCostLedger({ clock });
  return { datasets, ids: newIds(), clock, generator: createFakeVisualGeneration({ ledger, clock, ids: newIds(), deliverImage: true }) };
};

async function generate(name = "kopi-lawas-promotion") {
  const s = scaffold(name);
  const r = await runVisualGeneration(genDeps(), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
  if (r.status !== "OK") throw new Error("generation did not succeed in the fixture");
  return { ...s, artifact: r.artifact, request: r.request };
}

const replay = (payloadName?: string) => {
  const ledger = createCostLedger({ clock });
  const port = createReplayVisualEvidence({
    ledger,
    clock,
    ids: newIds(),
    datasetVersion: datasets.version,
    payload: payloadName ? loadObservationPayload(payloadName) : SYNTHETIC_OBSERVATION_PAYLOAD
  });
  return { ledger, port };
};

// --- 1 / 2 — observations parse, report is a valid artifact -------

describe("visual evidence: structured observations become a valid artifact", () => {
  it("1 — the replayed observation payload parses into the evidence report", async () => {
    const { artifact } = await generate();
    const { port } = replay("kopi-lawas-observations");
    const result = await port.observe({ artifact, imageBytes: IMAGE_BYTES, mimeType: "image/png" }, { projectId: "proj_x" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.observations.region_count).toBe(5);
    expect(result.value.observations.regions).toHaveLength(5);
    expect(result.value.observations.text_region_count).toBe(2);
    expect(result.value.observations.dominant_region_id).toBe("region-01");
  });

  it("2 — the assembled report validates against its own schema and is frozen", async () => {
    const { artifact } = await generate();
    const { port } = replay("kopi-lawas-observations");
    const result = await port.observe({ artifact, imageBytes: IMAGE_BYTES, mimeType: "image/png" }, { projectId: "proj_x" });
    if (!result.ok) throw new Error("expected OK");
    expect(VisualEvidenceReport.safeParse(result.value).success).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
  });
});

// --- 3 — provenance is copied from the artifact, never recomputed ---

describe("visual evidence: provenance binding", () => {
  it("3 — the report binds to the generated artifact by hash, verbatim", async () => {
    const { artifact } = await generate();
    const { port } = replay();
    const result = await port.observe({ artifact, imageBytes: IMAGE_BYTES, mimeType: "image/png" }, { projectId: "proj_x" });
    if (!result.ok) throw new Error("expected OK");
    const p = result.value.provenance;
    expect(p.generated_artifact_id).toBe(artifact.artifact_id);
    expect(p.artifact_hash).toBe(artifact.artifact_hash);
    expect(p.recipe_hash).toBe(artifact.provenance.recipe_hash);
    expect(p.blueprint_hash).toBe(artifact.provenance.blueprint_hash);
    expect(p.prompt_hash).toBe(artifact.provenance.prompt_hash);
    expect(p.generation_request_hash).toBe(artifact.request_hash);
    expect(p.provider).toBe(artifact.provider);
    expect(p.model).toBe(artifact.model);
  });
});

// --- 4 — deterministic hash ------------------------------------

describe("visual evidence: deterministic hash", () => {
  it("4 — replaying the same payload for the same artifact yields the same evidence_hash", async () => {
    const { artifact } = await generate();
    const a = await replay("kopi-lawas-observations").port.observe(
      { artifact, imageBytes: IMAGE_BYTES, mimeType: "image/png" },
      { projectId: "proj_x" }
    );
    const b = await replay("kopi-lawas-observations").port.observe(
      { artifact, imageBytes: IMAGE_BYTES, mimeType: "image/png" },
      { projectId: "proj_x" }
    );
    if (!a.ok || !b.ok) throw new Error("expected OK");
    expect(a.value.evidence_hash).toBe(b.value.evidence_hash);
    // the hash excludes the volatile id / timestamp
    expect(a.value.evidence_hash).not.toContain(a.value.evidence_id);
  });
});

// --- 5 / 6 — no judgment, no recommendation ---------------------

describe("visual evidence: carries no judgment", () => {
  const JUDGMENT = /\b(verdict|score|pass_fail|passfail|is_good|quality_score|recommend|recommendation|approv|critique|good|bad|weak|strong|correct|wrong|should)\b/i;

  it("5 / 6 — no judgment / recommendation keys anywhere in the report", async () => {
    const { artifact } = await generate();
    const { port } = replay("kopi-lawas-observations");
    const result = await port.observe({ artifact, imageBytes: IMAGE_BYTES, mimeType: "image/png" }, { projectId: "proj_x" });
    if (!result.ok) throw new Error("expected OK");
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [k, val] of Object.entries(v)) {
          keys.add(k);
          walk(val);
        }
      } else if (Array.isArray(v)) v.forEach(walk);
    };
    walk(result.value);
    const offenders = [...keys].filter((k) => JUDGMENT.test(k));
    expect(offenders).toEqual([]);
  });

  it("5 / 6 — the schema source declares no judgment / recommendation field", () => {
    const raw = readFileSync(new URL("../../types/schemas/visual-evidence-report.schema.ts", import.meta.url), "utf8");
    // strip comments — the header prose references the P2.15 critic on purpose
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(code).not.toMatch(/verdict|quality_score|pass_fail|recommendation|\bapprove\b|\bcritique\b/i);
  });
});

// --- 7 — replay books NO cost --------------------------------

describe("visual evidence: cost accounting", () => {
  it("7 — the replay adapter books no cost event", async () => {
    const { artifact } = await generate();
    const { ledger, port } = replay("kopi-lawas-observations");
    await port.observe({ artifact, imageBytes: IMAGE_BYTES, mimeType: "image/png" }, { projectId: "proj_x" });
    expect(ledger.list()).toHaveLength(0);
  });

  it("8 — a real vision inspection books exactly one cost event, on success", async () => {
    const { artifact } = await generate();
    const ledger = createCostLedger({ clock });
    const okCall: RawVisionCall = async () => ({
      ok: true,
      provider: "google",
      model_id: "gemini-3.1-flash-lite",
      latency_ms: 12,
      observations: SYNTHETIC_OBSERVATION_PAYLOAD,
      input_tokens: 1200,
      output_tokens: 240,
      estimated_cost_usd: 0.0004
    });
    const port = createVisualEvidenceClient({
      call: okCall,
      source: { kind: "vision-model", provider: "google", model: "gemini-3.1-flash-lite" },
      ledger,
      clock,
      ids: newIds(),
      meter: true,
      datasetVersion: datasets.version
    });
    const result = await port.observe({ artifact, imageBytes: IMAGE_BYTES, mimeType: "image/png" }, { projectId: "proj_c" });
    expect(result.ok).toBe(true);
    const events = ledger.list("proj_c");
    expect(events).toHaveLength(1);
    expect(events[0]!.stage).toBe("visual_evidence");
    expect(events[0]!.status).toBe("ok");
  });

  it("8 — a failed vision inspection still books exactly one cost event", async () => {
    const { artifact } = await generate();
    const ledger = createCostLedger({ clock });
    const failCall: RawVisionCall = async () => ({
      ok: false,
      provider: "google",
      model_id: "gemini-3.1-flash-lite",
      latency_ms: 5,
      error: { code: "rate_limited", message: "quota" }
    });
    const port = createVisualEvidenceClient({
      call: failCall,
      source: { kind: "vision-model", provider: "google", model: "gemini-3.1-flash-lite" },
      ledger,
      clock,
      ids: newIds(),
      meter: true,
      datasetVersion: datasets.version
    });
    const result = await port.observe({ artifact, imageBytes: IMAGE_BYTES, mimeType: "image/png" }, { projectId: "proj_f" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]!.code).toBe("rate_limited");
    const events = ledger.list("proj_f");
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe("failed");
  });
});

// --- 9 — image required; never fabricated -------------------

describe("visual evidence: the image is required", () => {
  it("9 — an empty image is rejected, not observed", async () => {
    const { artifact } = await generate();
    const { port } = replay();
    const result = await port.observe({ artifact, imageBytes: new Uint8Array(), mimeType: "image/png" }, { projectId: "proj_x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]!.code).toBe("image_missing");
  });
});

// --- 10 — nulls are named as unassessed, never defaulted ----

describe("visual evidence: unassessed fields are named", () => {
  it("10 — a payload with null observations lists them under unassessed", async () => {
    const { artifact } = await generate();
    const sparse = {
      ...SYNTHETIC_OBSERVATION_PAYLOAD,
      whitespace_share: null,
      approx_visual_density: null,
      color: null,
      person_present: null
    };
    const ledger = createCostLedger({ clock });
    const port = createReplayVisualEvidence({ ledger, clock, ids: newIds(), datasetVersion: datasets.version, payload: sparse });
    const result = await port.observe({ artifact, imageBytes: IMAGE_BYTES, mimeType: "image/png" }, { projectId: "proj_x" });
    if (!result.ok) throw new Error("expected OK");
    expect(result.value.unassessed).toContain("whitespace_share");
    expect(result.value.unassessed).toContain("color");
    expect(result.value.unassessed).toContain("person_present");
    expect(result.value.observations.whitespace_share).toBeNull();
  });
});

// --- 11 — stale artifact rejected at the service seam --------

describe("visual evidence service: rejects a stale pairing", () => {
  it("11 — a recipe hash that does not match the artifact is rejected, not observed", async () => {
    const { artifact, recipe, blueprint } = await generate();
    const staleRecipe = { ...recipe, recipe_hash: "deadbeef" };
    const ledger = createCostLedger({ clock });
    const deps = {
      datasets,
      ids: newIds(),
      clock,
      observer: createReplayVisualEvidence({ ledger, clock, ids: newIds(), datasetVersion: datasets.version })
    };
    const result = await runVisualEvidence(deps, {
      artifact,
      recipe: staleRecipe,
      blueprint,
      imageBase64: FAKE_PLACEHOLDER_PNG_BASE64,
      mimeType: "image/png"
    });
    expect(result.status).toBe("ERROR");
    if (result.status !== "ERROR") return;
    expect(result.issues?.[0]?.code).toBe("stale_artifact");
  });

  it("11 — a matching pairing is observed and returns an evidence report", async () => {
    const { artifact, recipe, blueprint } = await generate();
    const ledger = createCostLedger({ clock });
    const deps = {
      datasets,
      ids: newIds(),
      clock,
      observer: createReplayVisualEvidence({ ledger, clock, ids: newIds(), datasetVersion: datasets.version })
    };
    const result = await runVisualEvidence(deps, {
      artifact,
      recipe,
      blueprint,
      imageBase64: FAKE_PLACEHOLDER_PNG_BASE64,
      mimeType: "image/png"
    });
    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    expect(result.evidence.provenance.artifact_hash).toBe(artifact.artifact_hash);
  });
});

// --- 12 — the Gemini vision adapter is provider-isolated -----

describe("visual evidence: provider isolation", () => {
  it("12 — the Gemini vision adapter replays a recorded response with no network", async () => {
    const { artifact } = await generate();
    const ledger = createCostLedger({ clock });
    const recorded = {
      candidates: [{ content: { parts: [{ text: JSON.stringify(SYNTHETIC_OBSERVATION_PAYLOAD) }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 }
    };
    const port = createGeminiVisualEvidence({
      apiKey: "test-key-not-real",
      clock,
      ids: newIds(),
      ledger,
      datasetVersion: datasets.version,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => recorded, text: async () => JSON.stringify(recorded) })
    });
    const result = await port.observe({ artifact, imageBytes: IMAGE_BYTES, mimeType: "image/png" }, { projectId: "proj_g" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source.kind).toBe("vision-model");
    expect(result.value.source.provider).toBe("google");
    expect(ledger.list("proj_g")).toHaveLength(1);
  });

  it("getEvidenceDeps honours EVIDENCE_PROVIDER=replay", () => {
    const prev = process.env["EVIDENCE_PROVIDER"];
    process.env["EVIDENCE_PROVIDER"] = "replay";
    try {
      const deps = getEvidenceDeps();
      expect(typeof deps.observer.observe).toBe("function");
    } finally {
      if (prev === undefined) delete process.env["EVIDENCE_PROVIDER"];
      else process.env["EVIDENCE_PROVIDER"] = prev;
    }
  });
});
