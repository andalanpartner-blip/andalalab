"use client";

import { useCallback, useState } from "react";
import styles from "./VisualInspection.module.css";
import { Button } from "../ui/Button";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Disclosure } from "../ui/Disclosure";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DesignDirection } from "../../types/schemas/direction.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type {
  DesignCriticReport,
  LayoutBlueprint
} from "../../engine";
import type {
  GeneratedArtifact,
  GenerationRequest
} from "../../types/schemas/visual-generation.schema";
import type { VisualEvidenceReport } from "../../types/schemas/visual-evidence-report.schema";
import type { DesignCritique } from "../../types/schemas/design-critique.schema";
import type { CorrectionRecommendation } from "../../types/schemas/correction-recommendation.schema";
import type { CorrectionCycle } from "../../types/schemas/correction-cycle.schema";
import type { CreativeDecision } from "../../types/schemas/creative-decision.schema";
import { useProjectId } from "./project-context";

/**
 * The optional vision-assisted inspection panel (P2.17).
 *
 * The human triggers each step. "Inspect" observes the render, compares it to
 * the design intent and derives bounded correction options — it does NOT judge
 * whether the image is good, and it never regenerates. "Apply" runs one bounded
 * P6 correction from the options the human selects; the human then chooses,
 * separately, whether to regenerate.
 */

type InspectResponse =
  | { status: "OK"; evidence: VisualEvidenceReport; critique: DesignCritique; recommendation: CorrectionRecommendation }
  | { status: "ERROR"; message: string };

type ApplyResponse =
  | {
      status: "OK";
      recipe: DesignRecipe;
      contract: DesignContract;
      direction: DesignDirection;
      critic: DesignCriticReport;
      blueprint: LayoutBlueprint;
      correction: { diff: { changed_paths: string[] } };
      cycle: CorrectionCycle;
      decision: CreativeDecision | null;
    }
  | { status: "REDESIGN" | "NOOP"; correction: { reason: string } }
  | { status: "ERROR"; message: string };

export type VisualInspectionProps = {
  readonly recipe: DesignRecipe;
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly concept: CreativeConcept | null;
  readonly blueprint: LayoutBlueprint | null;
  readonly artifact: GeneratedArtifact;
  /** The generation request that produced `artifact` — needed to record the decision. */
  readonly request: GenerationRequest | null;
  readonly imageDataUrl: string;
  readonly onCorrectionApplied: (next: {
    recipe: DesignRecipe;
    contract: DesignContract;
    direction: DesignDirection;
    critic: DesignCriticReport;
    blueprint: LayoutBlueprint;
    changedPaths: readonly string[];
    cycle: CorrectionCycle | null;
    decision: CreativeDecision | null;
  }) => void;
};

const VERDICT_TONE: Record<string, BadgeTone> = {
  PASS: "ok",
  REVIEW: "attention",
  BLOCK: "critical",
  UNASSESSED: "neutral"
};

const CLASS_TONE: Record<string, BadgeTone> = {
  compliant: "ok",
  minor_mismatch: "neutral",
  major_mismatch: "attention",
  unassessed: "neutral"
};

export function VisualInspection({
  recipe,
  contract,
  direction,
  concept,
  blueprint,
  artifact,
  request,
  imageDataUrl,
  onCorrectionApplied
}: VisualInspectionProps) {
  const projectId = useProjectId();
  const [state, setState] = useState<"idle" | "inspecting" | "inspected" | "applying">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<InspectResponse, { status: "OK" }> | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const inspect = useCallback(async () => {
    setState("inspecting");
    setError(null);
    setApplied(null);
    try {
      const res = await fetch("/api/vision-loop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "inspect",
          projectId,
          artifact,
          recipe,
          contract,
          blueprint,
          imageBase64: imageDataUrl,
          mimeType: artifact.image.mime_type
        })
      });
      const data = (await res.json()) as InspectResponse;
      if (data.status === "OK") {
        setResult(data);
        setState("inspected");
      } else {
        setError(data.message);
        setState("idle");
      }
    } catch {
      setError("The inspection request could not be sent.");
      setState("idle");
    }
  }, [artifact, recipe, contract, blueprint, imageDataUrl, projectId]);

  const applyOption = useCallback(
    async (code: string) => {
      if (!result) return;
      setState("applying");
      setError(null);
      try {
        const res = await fetch("/api/vision-loop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "apply-correction",
            recommendation: result.recommendation,
            critique: result.critique,
            evidence: result.evidence,
            artifact,
            selectedCodes: [code],
            parentRecipe: recipe,
            contract,
            direction,
            concept,
            // P2.18 — lets the server record the `needs_correction` decision
            request,
            parentBlueprint: blueprint,
            projectId
          })
        });
        const data = (await res.json()) as ApplyResponse;
        if (data.status === "OK") {
          setApplied(code);
          setState("inspected");
          onCorrectionApplied({
            recipe: data.recipe,
            contract: data.contract,
            direction: data.direction,
            critic: data.critic,
            blueprint: data.blueprint,
            changedPaths: data.correction.diff.changed_paths,
            cycle: data.cycle ?? null,
            decision: data.decision ?? null
          });
        } else if (data.status === "ERROR") {
          setError(data.message);
          setState("inspected");
        } else {
          setError(data.correction.reason);
          setState("inspected");
        }
      } catch {
        setError("The correction request could not be sent.");
        setState("inspected");
      }
    },
    [result, artifact, request, recipe, contract, direction, blueprint, concept, projectId, onCorrectionApplied]
  );

  return (
    <section className={styles.section} aria-labelledby="inspection-heading">
      <div className={styles.head}>
        <div>
          <p className={styles.kicker}>Optional · AI inspection</p>
          <h3 id="inspection-heading" className={styles.title}>
            Compare the render to the design intent
          </h3>
          <p className={styles.sub}>
            This observes what is in the image and compares it to the resolved recipe and layout. It
            does not decide whether the visual is good — you do — and it never regenerates on its own.
          </p>
        </div>
        {state !== "idle" && result ? (
          <Badge tone={VERDICT_TONE[result.critique.verdict] ?? "neutral"} variant="soft">
            {result.critique.verdict}
          </Badge>
        ) : null}
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {state === "idle" && !result ? (
        <Button variant="secondary" onClick={() => void inspect()} trailing="→">
          Inspect this visual
        </Button>
      ) : null}

      {state === "inspecting" ? (
        <p className={styles.status} role="status" aria-live="polite">
          Observing the render and comparing it to the intent…
        </p>
      ) : null}

      {result ? (
        <>
          <p className={styles.summary}>{result.critique.summary}</p>

          <h4 className={styles.blockHeading}>What was observed</h4>
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt>Regions / text regions</dt>
              <dd>
                {result.evidence.observations.region_count ?? "—"} /{" "}
                {result.evidence.observations.text_region_count ?? "—"}
              </dd>
            </div>
            <div className={styles.row}>
              <dt>Observed aspect ratio</dt>
              <dd>{result.evidence.image.aspect_ratio}</dd>
            </div>
            {result.evidence.unassessed.length > 0 ? (
              <div className={styles.row}>
                <dt>Not observed</dt>
                <dd>{result.evidence.unassessed.join(", ")}</dd>
              </div>
            ) : null}
          </dl>

          <h4 className={styles.blockHeading}>Intent vs render</h4>
          <ul className={styles.findings}>
            {result.critique.findings
              .filter((f) => f.classification !== "compliant")
              .map((f) => (
                <li key={f.code} className={styles.finding}>
                  <div className={styles.findingHead}>
                    <Badge tone={CLASS_TONE[f.classification] ?? "neutral"} variant="soft">
                      {f.classification.replace("_", " ")}
                    </Badge>
                    <span className={styles.findingTitle}>{f.title}</span>
                  </div>
                  <p className={styles.comparison}>{f.comparison}</p>
                </li>
              ))}
            {result.critique.findings.every((f) => f.classification === "compliant") ? (
              <li className={styles.finding}>Every assessed dimension matches the intent.</li>
            ) : null}
          </ul>

          {result.recommendation.options.length > 0 ? (
            <>
              <h4 className={styles.blockHeading}>Bounded correction options</h4>
              <p className={styles.gateNote}>
                Nothing is applied until you choose it. Applying one runs a single bounded P6
                correction and leaves the concept, brand, movement and layout grammar untouched.
                You then decide, separately, whether to regenerate.
              </p>
              <ul className={styles.options}>
                {result.recommendation.options.map((o) => (
                  <li key={o.code} className={styles.option}>
                    <div>
                      <p className={styles.optionProblem}>{o.problem}</p>
                      <p className={styles.optionDetail}>
                        {o.scope === "single_parameter"
                          ? `${o.parameter_path}: ${o.current_value} → ${o.proposed_value} (Δ${
                              (o.delta ?? 0) >= 0 ? "+" : ""
                            }${o.delta}), within ±${o.bounds?.max_abs_delta}`
                          : "Regenerate only — no recipe parameter changes."}
                      </p>
                    </div>
                    {o.scope === "single_parameter" ? (
                      <Button
                        size="sm"
                        variant={applied === o.code ? "ghost" : "secondary"}
                        disabled={state === "applying" || applied === o.code}
                        onClick={() => void applyOption(o.code)}
                      >
                        {applied === o.code ? "Applied" : "Apply this correction"}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={styles.gateNote}>{result.recommendation.note}</p>
          )}

          {applied ? (
            <p className={styles.appliedNote} role="status">
              Correction applied — the recipe changed. The visual above no longer matches it. Use
              <b> Regenerate</b> to produce a new visual from the corrected design, or review the
              corrected recipe / layout / prompt first.
            </p>
          ) : null}

          <Disclosure title="Provenance">
            <dl className={styles.rows}>
              <div className={styles.row}>
                <dt>Evidence hash</dt>
                <dd className={styles.mono}>{result.evidence.evidence_hash}</dd>
              </div>
              <div className={styles.row}>
                <dt>Critique hash</dt>
                <dd className={styles.mono}>{result.critique.critique_hash}</dd>
              </div>
              <div className={styles.row}>
                <dt>Recommendation hash</dt>
                <dd className={styles.mono}>{result.recommendation.recommendation_hash}</dd>
              </div>
              <div className={styles.row}>
                <dt>Observed by</dt>
                <dd>
                  {result.evidence.source.provider} · {result.evidence.source.model} (
                  {result.evidence.source.kind})
                </dd>
              </div>
            </dl>
          </Disclosure>
        </>
      ) : null}
    </section>
  );
}
