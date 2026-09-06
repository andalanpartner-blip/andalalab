"use client";

import styles from "./FinalStage.module.css";
import { StageHeader } from "../ui/StageHeader";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Disclosure } from "../ui/Disclosure";
import type { StageId } from "../../lib/workspace";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type { LayoutBlueprint } from "../../types/schemas/layout-blueprint.schema";
import type { GeneratedArtifact } from "../../types/schemas/visual-generation.schema";
import type { CreativeDecision } from "../../types/schemas/creative-decision.schema";
import type { CorrectionCycle } from "../../types/schemas/correction-cycle.schema";

/**
 * The Final stage (P2.18).
 *
 * It shows the ONE visual a human explicitly approved, the decision itself, the
 * full provenance, and the correction lineage that led here. There is no
 * publishing, sharing, export, client portal or public URL — hand-off is a
 * later, separate concern.
 */

export type FinalStageProps = {
  readonly aspectRatio: string;
  readonly decision: CreativeDecision | null;
  readonly artifact: GeneratedArtifact | null;
  readonly imageDataUrl: string | null;
  readonly recipe: DesignRecipe;
  readonly blueprint: LayoutBlueprint | null;
  readonly concept: CreativeConcept | null;
  readonly correctionCycles: readonly CorrectionCycle[];
  /** True only when `decision` is an `approved` decision current for `artifact`. */
  readonly approved: boolean;
  readonly onNavigate: (stage: StageId) => void;
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function FinalStage({
  aspectRatio,
  decision,
  artifact,
  imageDataUrl,
  recipe,
  blueprint,
  concept,
  correctionCycles,
  approved,
  onNavigate
}: FinalStageProps) {
  if (!approved || !decision || !artifact) {
    return (
      <section className={`container ${styles.section}`} aria-labelledby="final-heading">
        <StageHeader
          kicker="Stage 10 · Final"
          title="Final"
          id="final-heading"
          aside={<Badge tone="neutral" variant="outline">Awaiting approval</Badge>}
        />
        <p className={styles.lede}>
          The final visual is the one a human explicitly approves in Review. Nothing is approved yet.
        </p>
        <div className={styles.frame} data-ratio={aspectRatio} aria-hidden="true">
          <span className={styles.frameLabel}>No approved visual · {aspectRatio}</span>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => onNavigate("review")} trailing="→">
            Go to Review
          </Button>
        </div>
      </section>
    );
  }

  const s = decision.subject;

  return (
    <section className={`container ${styles.section}`} aria-labelledby="final-heading">
      <StageHeader
        kicker="Stage 10 · Final"
        title="Final — approved"
        id="final-heading"
        sub="This visual was explicitly approved by a human. The decision, its provenance and the lineage that led here are recorded below."
        aside={<Badge tone="ok" variant="soft" dot>Approved</Badge>}
      />

      <div className={styles.grid}>
        <div className={styles.visualCol}>
          {imageDataUrl ? (
            <figure className={styles.figure}>
              <img
                className={styles.image}
                src={imageDataUrl}
                alt={`Approved visual for ${concept ? `“${concept.proposal.name}”` : recipe.objective}, ${artifact.image.width}×${artifact.image.height} px`}
                width={artifact.image.width}
                height={artifact.image.height}
              />
              <figcaption className={styles.caption}>
                {artifact.image.width} × {artifact.image.height} px · {artifact.provider} · {artifact.model}
              </figcaption>
            </figure>
          ) : (
            <div className={styles.metadataOnly}>
              <p className={styles.metadataHead}>Approved — image not transported in this build</p>
              <p className={styles.metadataBody}>
                The approval is recorded against artifact <span className={styles.mono}>{artifact.artifact_hash}</span>.
                The image bytes are not persisted; the record below is the full provenance.
              </p>
            </div>
          )}
        </div>

        <div className={styles.infoCol}>
          <h3 className={styles.blockHeading}>The human decision</h3>
          <dl className={styles.rows}>
            <div className={styles.row}><dt>Decision</dt><dd>Approved</dd></div>
            <div className={styles.row}><dt>Decided by</dt><dd>{decision.actor.display_name}</dd></div>
            <div className={styles.row}><dt>When</dt><dd>{formatTimestamp(decision.created_at)}</dd></div>
            {decision.note ? (
              <div className={styles.row}><dt>Note</dt><dd>{decision.note}</dd></div>
            ) : null}
            <div className={styles.row}><dt>Decision hash</dt><dd className={styles.mono}>{decision.decision_hash}</dd></div>
          </dl>

          <h3 className={styles.blockHeading}>Provenance</h3>
          <dl className={styles.rows}>
            <div className={styles.row}><dt>Recipe</dt><dd className={styles.mono}>{s.recipe_hash}</dd></div>
            <div className={styles.row}><dt>Layout blueprint</dt><dd className={styles.mono}>{s.blueprint_hash ?? "— (none)"}</dd></div>
            <div className={styles.row}><dt>Prompt</dt><dd className={styles.mono}>{s.prompt_hash}</dd></div>
            <div className={styles.row}><dt>Generation request</dt><dd className={styles.mono}>{s.generation_request_hash}</dd></div>
            <div className={styles.row}><dt>Generated artifact</dt><dd className={styles.mono}>{s.artifact_hash}</dd></div>
            <div className={styles.row}><dt>Blueprint (current)</dt><dd className={styles.mono}>{blueprint?.blueprint_hash ?? "— (none)"}</dd></div>
          </dl>

          {(decision.context.evidence_hash || decision.context.critique_hash || correctionCycles.length > 0) && (
            <>
              <h3 className={styles.blockHeading}>Lineage</h3>
              <ol className={styles.lineage}>
                <li>
                  <span className={styles.lineageStep}>Recipe {recipe.derived_from ? "(corrected)" : "v1"}</span>
                  <span className={styles.lineageHash}>{recipe.recipe_hash}</span>
                </li>
                {correctionCycles.map((cycle, index) => (
                  <li key={cycle.cycle_hash}>
                    <span className={styles.lineageStep}>
                      Correction {index + 1}: {cycle.selected_options.join(", ") || "regenerate-only"}
                    </span>
                    <span className={styles.lineageHash}>
                      {cycle.parent.recipe_hash} → {cycle.corrected?.recipe_hash ?? "—"}
                    </span>
                  </li>
                ))}
                {decision.context.evidence_hash ? (
                  <li>
                    <span className={styles.lineageStep}>Vision inspection</span>
                    <span className={styles.lineageHash}>
                      evidence {decision.context.evidence_hash}
                      {decision.context.critique_hash ? ` · critique ${decision.context.critique_hash}` : ""}
                    </span>
                  </li>
                ) : null}
                <li>
                  <span className={styles.lineageStep}>Human approval</span>
                  <span className={styles.lineageHash}>{decision.decision_hash}</span>
                </li>
              </ol>
            </>
          )}

          <Disclosure title="Full decision record">
            <pre className={styles.json}>{JSON.stringify(decision, null, 2)}</pre>
          </Disclosure>

          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => onNavigate("review")}>
              Back to Review
            </Button>
          </div>
          <p className={styles.note}>
            This is the internal hand-off record. There is no public link, export or share — those
            are a separate, later concern.
          </p>
        </div>
      </div>
    </section>
  );
}
