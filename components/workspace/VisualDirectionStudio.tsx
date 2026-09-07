"use client";

import { useState } from "react";
import { VISUAL_DIRECTIONS, type VisualDirection } from "../../engine/direction/directions";
import type { VisualDirectionOverview } from "../../engine";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DesignDirection } from "../../types/schemas/direction.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type {
  DesignCriticReport,
  LayoutBlueprint as LayoutBlueprintArtifact,
  LayoutTemplateOverview
} from "../../engine";
import { LayoutSchematic } from "./LayoutSchematic";
import { Button } from "../ui/Button";
import { Disclosure } from "../ui/Disclosure";
import styles from "./VisualDirectionStudio.module.css";

export type DirectionRetargetPayload = {
  readonly recipe: DesignRecipe;
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly critic: DesignCriticReport;
  readonly blueprint: LayoutBlueprintArtifact;
  readonly layoutTemplates: LayoutTemplateOverview;
  readonly visualDirections: VisualDirectionOverview;
  readonly appliedDirection: VisualDirection;
  readonly changedPaths: readonly string[];
};

type Props = {
  readonly overview: VisualDirectionOverview;
  /** The AI's ORIGINAL recommendation, frozen at recipe-build time (from Workspace). */
  readonly aiRecommendedDirectionId: string | null;
  readonly aiRecommendedName: string | null;
  /** The direction the human has explicitly applied this session (null before any). */
  readonly appliedDirectionId: string | null;
  readonly why: string | null;
  readonly recipe: DesignRecipe;
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly concept: CreativeConcept | null;
  readonly hasGeneratedArtifact: boolean;
  readonly onApplied: (payload: DirectionRetargetPayload) => void;
};

type RetargetResponse = {
  status: string;
  message?: string;
  recipe?: DesignRecipe;
  contract?: DesignContract;
  direction?: DesignDirection;
  critic?: DesignCriticReport;
  blueprint?: LayoutBlueprintArtifact;
  layoutTemplates?: LayoutTemplateOverview;
  visualDirections?: VisualDirectionOverview;
};

async function postRetarget(body: unknown): Promise<RetargetResponse> {
  const res = await fetch("/api/direction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return (await res.json()) as RetargetResponse;
}

export function VisualDirectionStudio({
  overview,
  aiRecommendedDirectionId,
  aiRecommendedName,
  appliedDirectionId,
  why,
  recipe,
  contract,
  direction,
  concept,
  hasGeneratedArtifact,
  onApplied
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recommended = aiRecommendedDirectionId
    ? VISUAL_DIRECTIONS.find((d) => d.id === aiRecommendedDirectionId) ?? null
    : null;
  // What the recipe currently expresses: the human's explicit choice if there
  // is one, otherwise the direction the AI's recipe maps to.
  const currentId = appliedDirectionId ?? overview.currentDirectionId;
  const designerSelected =
    appliedDirectionId && aiRecommendedDirectionId && appliedDirectionId !== aiRecommendedDirectionId
      ? VISUAL_DIRECTIONS.find((d) => d.id === appliedDirectionId) ?? null
      : null;

  const previewDirection = previewId ? VISUAL_DIRECTIONS.find((d) => d.id === previewId) ?? null : null;

  async function apply(chosen: VisualDirection) {
    setApplyingId(chosen.id);
    setError(null);
    const data = await postRetarget({
      contract,
      direction,
      concept,
      parentRecipe: recipe,
      directionId: chosen.id
    });
    setApplyingId(null);
    if (
      data.status === "OK" &&
      data.recipe &&
      data.contract &&
      data.direction &&
      data.critic &&
      data.blueprint &&
      data.layoutTemplates &&
      data.visualDirections
    ) {
      setPreviewId(null);
      onApplied({
        recipe: data.recipe,
        contract: data.contract,
        direction: data.direction,
        critic: data.critic,
        blueprint: data.blueprint,
        layoutTemplates: data.layoutTemplates,
        visualDirections: data.visualDirections,
        appliedDirection: chosen,
        // the direction drives imagery, colour, materiality, graphic language + photographic character
        changedPaths: ["imagery", "color", "materiality", "graphic_language", "photographic_character", "graphic_treatment"]
      });
    } else {
      setError(data.message ?? "That direction couldn't be applied.");
    }
  }

  return (
    <section className={styles.wrap} aria-labelledby="direction-studio-heading">
      <div className={styles.head}>
        <div>
          <h3 id="direction-studio-heading" className={styles.heading}>
            Visual Direction Studio
          </h3>
          <p className={styles.tagline}>
            Choose your visual direction. Start with our recommendation, or choose a visual language
            that fits your brand.
          </p>
        </div>
      </div>

      <div className={styles.recCard}>
        <div className={styles.recRows}>
          <div className={styles.recRow}>
            <span className={styles.recTag}>AI recommended</span>
            <span className={styles.recName}>
              {recommended ? recommended.name : overview.recommendedDirectionName}
            </span>
          </div>
          {designerSelected ? (
            <div className={styles.recRow}>
              <span className={styles.recTag} data-designer>
                Designer selected
              </span>
              <span className={styles.recName}>{designerSelected.name}</span>
            </div>
          ) : null}
        </div>
        {why ? <p className={styles.why}>{why}</p> : null}
        <div className={styles.recActions}>
          <Button size="sm" variant="secondary" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? "Hide directions" : "Explore directions"}
          </Button>
        </div>
      </div>

      {expanded ? (
        <>
          {previewDirection ? (
            <div className={styles.preview} role="status">
              <div className={styles.previewSchematic}>
                <LayoutSchematic schematic={previewDirection.schematic} size="detail" title={previewDirection.name} />
              </div>
              <div className={styles.previewBody}>
                <p className={styles.previewLabel}>Previewing {previewDirection.name}</p>
                <p className={styles.previewWhy}>{previewDirection.description}</p>
                <Disclosure title="Details — internal mapping">
                  <p className={styles.previewMapping}>{previewDirection.internalMapping}</p>
                </Disclosure>
                <div className={styles.previewActions}>
                  <Button
                    size="sm"
                    disabled={previewDirection.id === currentId || applyingId !== null}
                    loading={applyingId === previewDirection.id}
                    onClick={() => void apply(previewDirection)}
                    trailing="→"
                  >
                    Use this direction
                  </Button>
                  <Button size="sm" variant="link" onClick={() => setPreviewId(null)}>
                    Close preview
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className={styles.hint}>
              Preview a direction to see its visual language, then apply it. Applying re-derives the
              recipe, blueprint and prompt — it never generates an image.
            </p>
          )}

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          {hasGeneratedArtifact ? (
            <p className={styles.staleNote}>
              A visual has already been generated. Changing the direction leaves that image immutable
              and marks the current visual stale — you decide when to regenerate.
            </p>
          ) : null}

          <ul className={styles.grid}>
            {VISUAL_DIRECTIONS.map((d) => {
              const isRecommended = d.id === aiRecommendedDirectionId;
              const isCurrent = d.id === currentId;
              return (
                <li key={d.id}>
                  <div
                    className={styles.card}
                    data-current={isCurrent || undefined}
                    data-previewing={previewId === d.id || undefined}
                  >
                    <button
                      type="button"
                      className={styles.cardMain}
                      aria-pressed={previewId === d.id}
                      aria-label={`Preview ${d.name}`}
                      onClick={() => setPreviewId((id) => (id === d.id ? null : d.id))}
                    >
                      <div className={styles.cardHead}>
                        <span className={styles.cardIndex}>{d.index}</span>
                        <span className={styles.cardName}>{d.name}</span>
                      </div>
                      <LayoutSchematic schematic={d.schematic} title={d.name} />
                      <p className={styles.cardDesc}>{d.description}</p>
                      <div className={styles.badges}>
                        {isRecommended ? (
                          <span className={styles.badge} data-tone="rec">
                            AI Recommended
                          </span>
                        ) : null}
                        {isCurrent ? (
                          <span className={styles.badge} data-tone="current">
                            Current
                          </span>
                        ) : null}
                        <span className={styles.badge} data-tone="rep">
                          {d.representation}
                        </span>
                      </div>
                    </button>
                    <div className={styles.cardFoot}>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isCurrent || applyingId !== null}
                        loading={applyingId === d.id}
                        onClick={() => void apply(d)}
                      >
                        {isCurrent ? "In use" : "Use this direction"}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className={styles.footNote}>
            Nine user-facing directions over the existing representation, adapter and recipe system —
            a taste layer, not new taxonomy. {aiRecommendedName ? `AI recommended: ${aiRecommendedName}.` : ""}
          </p>
        </>
      ) : null}
    </section>
  );
}
