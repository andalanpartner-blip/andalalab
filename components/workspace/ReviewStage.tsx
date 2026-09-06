"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./ReviewStage.module.css";
import { StageHeader } from "../ui/StageHeader";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Disclosure } from "../ui/Disclosure";
import { ReviewSummary } from "../ReviewSummary";
import { VisualInspection } from "./VisualInspection";
import type { StageId } from "../../lib/workspace";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DesignDirection } from "../../types/schemas/direction.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type { LayoutBlueprint } from "../../types/schemas/layout-blueprint.schema";
import type { DesignCriticReport, VisualReviewReport } from "../../engine";
import type {
  GeneratedArtifact,
  GenerationRequest
} from "../../types/schemas/visual-generation.schema";
import { layoutContextLabel } from "../../lib/generate-view";
import {
  REVIEW_STATUS_LABEL,
  STALE_BLUEPRINT_NOTICE,
  STALE_RECIPE_NOTICE,
  TEST_PROVIDER_NOTICE,
  designIntentRows,
  generatedImageAlt,
  generationResultRows,
  hasDisplayableImage,
  isTestProviderArtifact,
  isVisualStaleForBlueprint,
  isVisualStaleForRecipe,
  metadataOnlyReason,
  promptContextLine,
  provenanceChainLabel,
  reviewProvenanceRows,
  type HumanReviewStatus
} from "../../lib/review-view";

/**
 * The Review stage — a human evaluates an already-generated visual against the
 * design intent the pipeline already resolved.
 *
 * This component recomputes nothing. It reads the recipe, contract, blueprint,
 * concept, generation request and artifact, and it renders the existing
 * `DesignCriticReport` / `VisualReviewReport` through `ReviewSummary` unchanged.
 * There is no image analysis here — "Continue to correction" means the human
 * decided the visual needs work, not that the system understood the pixels.
 */

export type ReviewStageProps = {
  readonly recipe: DesignRecipe;
  readonly contract: DesignContract;
  readonly concept: CreativeConcept | null;
  readonly blueprint: LayoutBlueprint | null;
  /** The direction the current recipe was built from — needed for a bounded correction. */
  readonly direction: DesignDirection | null;
  readonly critic: DesignCriticReport;
  readonly review: VisualReviewReport | null;
  /** The artifact from the Generate stage, or null if nothing has been generated. */
  readonly artifact: GeneratedArtifact | null;
  /** The request that produced `artifact` (carries the prompt tier / language). */
  readonly request: GenerationRequest | null;
  /** Transient session-only data URL for the generated image, if one was returned. */
  readonly imageDataUrl: string | null;
  readonly onNavigate: (stage: StageId) => void;
  /**
   * Called when a bounded correction from the optional AI inspection is applied.
   * The workspace threads the corrected recipe / blueprint / critic back in; the
   * generated visual is deliberately KEPT so the stale banner prompts a
   * deliberate regeneration.
   */
  readonly onCorrectionApplied?: (next: {
    recipe: DesignRecipe;
    contract: DesignContract;
    direction: DesignDirection;
    critic: DesignCriticReport;
    blueprint: LayoutBlueprint;
    changedPaths: readonly string[];
  }) => void;
};

const STATUS_TONE: Record<HumanReviewStatus, "neutral" | "ok" | "attention"> = {
  awaiting: "neutral",
  approved: "ok",
  needs_correction: "attention"
};

export function ReviewStage({
  recipe,
  contract,
  concept,
  blueprint,
  critic,
  review,
  direction,
  artifact,
  request,
  imageDataUrl,
  onNavigate,
  onCorrectionApplied
}: ReviewStageProps) {
  const [status, setStatus] = useState<HumanReviewStatus>("awaiting");
  const sectionRef = useRef<HTMLElement>(null);

  // A fresh artifact resets the human decision — a new render has not been judged.
  useEffect(() => {
    setStatus("awaiting");
  }, [artifact?.artifact_id]);

  // Focus management: move focus to the stage on entry (after a successful
  // generation the user lands here) without yanking the scroll position.
  useEffect(() => {
    sectionRef.current?.focus({ preventScroll: true });
  }, []);

  const approve = useCallback(() => setStatus("approved"), []);
  const sendToCorrection = useCallback(() => {
    setStatus("needs_correction");
    onNavigate("correct");
  }, [onNavigate]);

  const staleRecipe = isVisualStaleForRecipe(artifact, recipe.recipe_hash);
  const staleBlueprint = isVisualStaleForBlueprint(artifact, blueprint?.blueprint_hash ?? null);
  const showImage = artifact !== null && hasDisplayableImage(imageDataUrl);

  const intentRows = designIntentRows({ recipe, contract, blueprint, concept, request });

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className={`container ${styles.section}`}
      aria-labelledby="review-stage-heading"
    >
      <StageHeader
        kicker="Stage 8 · review the generated visual"
        title="Review the visual"
        id="review-stage-heading"
        sub="You evaluate the generated result against the design the pipeline already resolved. The system shows you the intent and what it already knows about compliance — the judgement is yours."
        aside={
          <Badge tone={STATUS_TONE[status]} variant="soft" dot>
            {REVIEW_STATUS_LABEL[status]}
          </Badge>
        }
      />

      {(staleRecipe || staleBlueprint) && (
        <div className={styles.stale} role="status">
          <p className={styles.staleHead}>Heads up — this visual may not match the current design</p>
          {staleRecipe && <p className={styles.staleLine}>{STALE_RECIPE_NOTICE}</p>}
          {staleBlueprint && <p className={styles.staleLine}>{STALE_BLUEPRINT_NOTICE}</p>}
          <p className={styles.staleLine}>
            It has not been regenerated. Return to{" "}
            <button type="button" className={styles.inlineLink} onClick={() => onNavigate("generate")}>
              Generate
            </button>{" "}
            to produce a visual from the current design.
          </p>
        </div>
      )}

      {artifact !== null && isTestProviderArtifact(artifact) && (
        <p className={styles.testNotice} role="note">
          {TEST_PROVIDER_NOTICE}
        </p>
      )}

      <div className={styles.grid}>
        {/* -------- left: the generated visual -------- */}
        <div className={styles.visualCol}>
          {artifact === null ? (
            <div className={styles.noVisual}>
              <p className={styles.noVisualHead}>No visual generated yet</p>
              <p className={styles.noVisualBody}>
                The Generate stage has not produced a visual for this design. You can still review
                the design intent and the pipeline&rsquo;s compliance check below.
              </p>
              <Button variant="secondary" onClick={() => onNavigate("generate")} trailing="→">
                Generate a visual
              </Button>
            </div>
          ) : showImage ? (
            <figure className={styles.figure}>
              <img
                className={styles.image}
                src={imageDataUrl as string}
                alt={generatedImageAlt({ artifact, contract, recipe, concept })}
                width={artifact.image.width}
                height={artifact.image.height}
              />
              <figcaption className={styles.caption}>
                {artifact.image.width} × {artifact.image.height} px ·{" "}
                {isTestProviderArtifact(artifact) ? "local test adapter" : `${artifact.provider} · ${artifact.model}`}
              </figcaption>
            </figure>
          ) : (
            <div className={styles.metadataOnly}>
              <p className={styles.metadataHead}>No image to display</p>
              <p className={styles.metadataBody}>{metadataOnlyReason(artifact)}</p>
            </div>
          )}
        </div>

        {/* -------- right: the review information -------- */}
        <div className={styles.infoCol}>
          <h3 className={styles.blockHeading}>What we intended to make</h3>
          <dl className={styles.rows}>
            {intentRows.map((row) => (
              <div key={row.label} className={styles.row}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>

          {artifact !== null && (
            <>
              <h3 className={styles.blockHeading}>What was actually generated</h3>
              <dl className={styles.rows}>
                {generationResultRows(artifact).map((row) => (
                  <div key={row.label} className={styles.row}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          <div className={styles.strips}>
            {blueprint && (
              <button
                type="button"
                className={styles.strip}
                onClick={() => onNavigate("layout")}
              >
                <span className={styles.stripLabel}>Layout confirmed</span>
                <span className={styles.stripValue}>{layoutContextLabel(blueprint)}</span>
                <span className={styles.stripLink}>View layout →</span>
              </button>
            )}
            <button type="button" className={styles.strip} onClick={() => onNavigate("prompt")}>
              <span className={styles.stripLabel}>Prompt used</span>
              <span className={styles.stripValue}>{promptContextLine({ request, artifact })}</span>
              <span className={styles.stripLink}>View prompt →</span>
            </button>
          </div>

          {artifact !== null && (
            <div className={styles.provenance}>
              <p className={styles.provenanceHead}>
                <span className={styles.provenanceKicker}>Based on</span>{" "}
                {provenanceChainLabel(artifact)}
              </p>
              <Disclosure title="Full provenance">
                <dl className={styles.rows}>
                  {reviewProvenanceRows(artifact).map((row) => (
                    <div key={row.label} className={styles.row}>
                      <dt>{row.label}</dt>
                      <dd className={styles.mono}>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </Disclosure>
            </div>
          )}
        </div>
      </div>

      {/* -------- existing compliance, rendered unchanged -------- */}
      <ReviewSummary report={review} critic={critic} onNavigate={onNavigate} />

      {/* -------- optional AI inspection (P2.17) — only for a current, real render -------- */}
      {artifact !== null &&
      showImage &&
      !staleRecipe &&
      !staleBlueprint &&
      direction !== null &&
      onCorrectionApplied ? (
        <VisualInspection
          recipe={recipe}
          contract={contract}
          direction={direction}
          concept={concept}
          blueprint={blueprint}
          artifact={artifact}
          imageDataUrl={imageDataUrl as string}
          onCorrectionApplied={onCorrectionApplied}
        />
      ) : null}

      {/* -------- the human decision -------- */}
      <div className={styles.decision}>
        <p className={styles.decisionLine} role="status" aria-live="polite">
          {status === "awaiting"
            ? "Your call: does this visual do the job?"
            : REVIEW_STATUS_LABEL[status]}
        </p>
        <div className={styles.actions}>
          {artifact === null ? (
            <Button onClick={() => onNavigate("generate")} trailing="→">
              Generate a visual
            </Button>
          ) : (
            <>
              <Button onClick={approve} disabled={status === "approved"}>
                {status === "approved" ? "Approved" : "Approve this visual"}
              </Button>
              <Button variant="secondary" onClick={sendToCorrection} trailing="→">
                Continue to correction
              </Button>
              <Button variant="ghost" onClick={() => onNavigate("generate")}>
                Regenerate
              </Button>
            </>
          )}
        </div>
        {artifact !== null && (
          <p className={styles.decisionNote}>
            &ldquo;Continue to correction&rdquo; records that you decided this visual needs work — the
            system is not judging the image itself. Regenerate routes back to the Generate stage; it
            never runs on its own.
          </p>
        )}
      </div>
    </section>
  );
}
