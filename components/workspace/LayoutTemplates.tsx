"use client";

import { useMemo, useState } from "react";
import { LAYOUT_TEMPLATES, type LayoutTemplate } from "../../engine/layout/templates";
import type { LayoutTemplateOverview } from "../../engine";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DesignDirection } from "../../types/schemas/direction.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type { DesignCriticReport, LayoutBlueprint as LayoutBlueprintArtifact } from "../../engine";
import { LayoutSchematic } from "./LayoutSchematic";
import { Button } from "../ui/Button";
import styles from "./LayoutTemplates.module.css";

export type LayoutRetargetPayload = {
  readonly recipe: DesignRecipe;
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly critic: DesignCriticReport;
  readonly blueprint: LayoutBlueprintArtifact;
  readonly layoutTemplates: LayoutTemplateOverview;
  readonly appliedTemplate: LayoutTemplate;
  readonly changedPaths: readonly string[];
};

type Props = {
  readonly overview: LayoutTemplateOverview;
  /** The AI's ORIGINAL recommendation, frozen at recipe-build time (from Workspace). */
  readonly aiRecommendedTemplateId: string | null;
  readonly aiRecommendedName: string | null;
  readonly visualTypeName: string;
  readonly recipe: DesignRecipe;
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly concept: CreativeConcept | null;
  /** True when a visual has already been generated — applying a layout makes it stale. */
  readonly hasGeneratedArtifact: boolean;
  readonly onApplied: (payload: LayoutRetargetPayload) => void;
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
};

async function postRetarget(body: unknown): Promise<RetargetResponse> {
  const res = await fetch("/api/layout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return (await res.json()) as RetargetResponse;
}

export function LayoutTemplates({
  overview,
  aiRecommendedTemplateId,
  aiRecommendedName,
  visualTypeName,
  recipe,
  contract,
  direction,
  concept,
  hasGeneratedArtifact,
  onApplied
}: Props) {
  const byId = useMemo(
    () => new Map(overview.templates.map((entry) => [entry.templateId, entry])),
    [overview]
  );

  // The AI recommendation is pinned to the recipe it was built for (Workspace
  // holds it). Applying a template updates `overview` (availability, current
  // layout) but the "AI recommended" line + badge stay on the original.
  const recommendedTemplate = aiRecommendedTemplateId
    ? LAYOUT_TEMPLATES.find((t) => t.id === aiRecommendedTemplateId) ?? null
    : null;

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The template the current recipe actually holds — reflects the last apply.
  const activeTemplateId =
    LAYOUT_TEMPLATES.find((t) => t.canonicalLayoutId === overview.currentLayoutId)?.id ?? null;

  const previewTemplate = previewId
    ? LAYOUT_TEMPLATES.find((t) => t.id === previewId) ?? null
    : null;
  const designerSelected =
    activeTemplateId && aiRecommendedTemplateId && activeTemplateId !== aiRecommendedTemplateId
      ? LAYOUT_TEMPLATES.find((t) => t.id === activeTemplateId) ?? null
      : null;

  async function apply(template: LayoutTemplate) {
    if (byId.get(template.id)?.status !== "available") return;
    setApplyingId(template.id);
    setError(null);
    const data = await postRetarget({
      contract,
      direction,
      concept,
      parentRecipe: recipe,
      layoutId: template.canonicalLayoutId
    });
    setApplyingId(null);
    if (
      data.status === "OK" &&
      data.recipe &&
      data.contract &&
      data.direction &&
      data.critic &&
      data.blueprint &&
      data.layoutTemplates
    ) {
      setPreviewId(null);
      onApplied({
        recipe: data.recipe,
        contract: data.contract,
        direction: data.direction,
        critic: data.critic,
        blueprint: data.blueprint,
        layoutTemplates: data.layoutTemplates,
        appliedTemplate: template,
        // the layout drives grid, hierarchy and composition arrangement
        changedPaths: ["grid", "hierarchy", "composition"]
      });
    } else {
      setError(data.message ?? "That layout couldn't be applied.");
    }
  }

  return (
    <section className={styles.wrap} aria-labelledby="explore-layouts-heading">
      <div className={styles.head}>
        <h3 id="explore-layouts-heading" className={styles.heading}>
          Explore layouts
        </h3>
        <div className={styles.recRow}>
          <span className={styles.recTag}>AI recommended</span>
          <span className={styles.recName}>
            {recommendedTemplate
              ? recommendedTemplate.name
              : aiRecommendedName
                ? `${aiRecommendedName} (not a preset)`
                : overview.currentLayoutName}
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

      {previewTemplate ? (
        <div className={styles.preview} role="status">
          <div className={styles.previewSchematic}>
            <LayoutSchematic
              schematic={previewTemplate.schematic}
              size="detail"
              title={previewTemplate.name}
            />
          </div>
          <div className={styles.previewBody}>
            <p className={styles.previewLabel}>Previewing {previewTemplate.name}</p>
            <p className={styles.previewCanonical}>
              Canonical layout · {byId.get(previewTemplate.id)?.canonicalLayoutName}{" "}
              <code>{previewTemplate.canonicalLayoutId}</code>
            </p>
            <p className={styles.previewWhy}>{previewTemplate.description}</p>
            <p className={styles.previewNote}>{byId.get(previewTemplate.id)?.reason}</p>
            <div className={styles.previewActions}>
              <Button
                size="sm"
                disabled={
                  byId.get(previewTemplate.id)?.status !== "available" ||
                  previewTemplate.canonicalLayoutId === overview.currentLayoutId ||
                  applyingId !== null
                }
                loading={applyingId === previewTemplate.id}
                onClick={() => void apply(previewTemplate)}
                trailing="→"
              >
                Use this layout
              </Button>
              <Button size="sm" variant="link" onClick={() => setPreviewId(null)}>
                Close preview
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className={styles.hint}>
          Preview a template to see its structure and rationale, then apply it. Applying re-derives
          the recipe, blueprint and prompt — it never generates an image.
        </p>
      )}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {hasGeneratedArtifact ? (
        <p className={styles.staleNote}>
          A visual has already been generated. Changing the layout leaves that image immutable and
          marks the current visual stale — you decide when to regenerate.
        </p>
      ) : null}

      <ul className={styles.grid}>
        {LAYOUT_TEMPLATES.map((template) => {
          const entry = byId.get(template.id)!;
          const isRecommended = template.id === aiRecommendedTemplateId;
          const isCurrent = template.canonicalLayoutId === overview.currentLayoutId;
          return (
            <li key={template.id}>
              <div
                className={styles.card}
                data-available={entry.status}
                data-current={isCurrent || undefined}
                data-previewing={previewId === template.id || undefined}
              >
                <button
                  type="button"
                  className={styles.cardMain}
                  aria-pressed={previewId === template.id}
                  aria-label={`Preview ${template.name}`}
                  onClick={() => setPreviewId((id) => (id === template.id ? null : template.id))}
                >
                  <div className={styles.cardHead}>
                    <span className={styles.cardIndex}>{template.index}</span>
                    <span className={styles.cardName}>{template.name}</span>
                  </div>
                  <LayoutSchematic schematic={template.schematic} title={template.name} />
                  <p className={styles.cardCanonical}>{entry.canonicalLayoutName}</p>
                  <p className={styles.cardDesc}>{template.description}</p>
                  <div className={styles.badges}>
                    <span className={styles.badge} data-tone={entry.status}>
                      {entry.status === "available" ? "Available" : "Not ideal for this format"}
                    </span>
                    {isRecommended ? (
                      <span className={styles.badge} data-tone="rec">
                        AI Recommended
                      </span>
                    ) : null}
                    {isCurrent && !isRecommended ? (
                      <span className={styles.badge} data-tone="current">
                        Current layout
                      </span>
                    ) : null}
                  </div>
                </button>
                <div className={styles.cardFoot}>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={entry.status !== "available" || isCurrent || applyingId !== null}
                    loading={applyingId === template.id}
                    onClick={() => void apply(template)}
                  >
                    {isCurrent ? "In use" : "Use this layout"}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className={styles.footNote}>
        Nine presentation templates over the existing layout grammar for {visualTypeName}. Availability
        is read from each layout&rsquo;s declared formats.
      </p>
    </section>
  );
}
