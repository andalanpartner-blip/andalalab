"use client";

import { useState } from "react";
import type { CreativeConcept } from "../types/schemas/concept.schema";
import styles from "./ConceptCompare.module.css";
import { StageHeader } from "./ui/StageHeader";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Panel } from "./ui/Panel";
import { humanize, percent } from "../lib/format";

export type ConceptCompareProps = {
  readonly concepts: readonly CreativeConcept[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly onBuildRecipe: () => void;
  readonly buildingRecipe: boolean;
  readonly hasRecipe: boolean;
  /** True when a recipe / review already exists — selecting a different concept resets them. */
  readonly hasDownstream: boolean;
};

/** One plain sentence explaining the fit score from the score breakdown. */
function fitExplanation(concept: CreativeConcept): string {
  const applicable = concept.score.breakdown.filter((d) => d.applicable);
  if (applicable.length === 0) return "Scored against strategic, audience and craft criteria.";
  const sorted = [...applicable].sort((a, b) => b.weighted - a.weighted);
  const strong = sorted.slice(0, 2).map((d) => humanize(d.dimension).toLowerCase());
  const weak = sorted[sorted.length - 1];
  const weakPhrase = weak && weak.raw < 0.6 ? `, weaker on ${humanize(weak.dimension).toLowerCase()}` : "";
  return `Strong on ${strong.join(" and ")}${weakPhrase}.`;
}

export function ConceptCompare({
  concepts,
  selectedId,
  onSelect,
  onBuildRecipe,
  buildingRecipe,
  hasRecipe,
  hasDownstream
}: ConceptCompareProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const selected = concepts.find((c) => c.id === selectedId) ?? concepts[0];

  const requestSelect = (id: string) => {
    if (id === selectedId) return;
    if (hasDownstream) {
      setPendingId(id);
      return;
    }
    onSelect(id);
  };

  const confirmSwap = () => {
    if (pendingId) onSelect(pendingId);
    setPendingId(null);
  };

  return (
    <section className={`container ${styles.section}`} aria-labelledby="concepts-heading">
      <StageHeader
        kicker="Three directions, one strategic idea"
        title="Creative Concepts"
        id="concepts-heading"
        sub="Each is scored against strategic, audience, industry, brand and craft criteria. Expand one for the full idea, then choose."
      />

      <div className={styles.grid}>
        {concepts.map((concept, index) => {
          const isSelected = concept.id === selectedId;
          const isExpanded = concept.id === expandedId;
          const p = concept.proposal;
          return (
            <div
              key={concept.id}
              className={styles.card}
              data-selected={isSelected || undefined}
              data-expanded={isExpanded || undefined}
            >
              <div className={styles.cardTop}>
                <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
                <Badge tone="neutral" variant="outline">
                  {percent(concept.score.total)} fit
                </Badge>
              </div>

              <h3 className={styles.name}>{p.name}</h3>
              <p className={styles.type}>{humanize(p.type)}</p>

              <p className={styles.idea}>{p.big_idea}</p>

              <p className={styles.fit}>{fitExplanation(concept)}</p>

              <p className={styles.risk}>
                <span className={styles.riskLabel}>Risk</span> {p.risk}
              </p>

              {isExpanded ? (
                <dl className={styles.detail}>
                  <dt>Creative tension</dt>
                  <dd>{p.creative_tension}</dd>
                  <dt>Visual metaphor</dt>
                  <dd>{p.visual_metaphor}</dd>
                  <dt>Why it works</dt>
                  <dd>{p.why}</dd>
                  <dt>Visual world</dt>
                  <dd>{p.visual_world}</dd>
                  <dt>Best for</dt>
                  <dd>{p.best_for.join(" · ")}</dd>
                </dl>
              ) : null}

              <div className={styles.cardActions}>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setExpandedId(isExpanded ? null : concept.id)}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? "Less" : "Full idea"}
                </Button>
                {isSelected ? (
                  <Badge tone="accent" variant="soft" dot>
                    Selected
                  </Badge>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => requestSelect(concept.id)}>
                    Choose this
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {pendingId ? (
        <Panel tone="action" className={styles.confirm}>
          <p className={styles.confirmText}>
            Switching concepts discards the current design recipe
            {hasRecipe ? " and its review" : ""}. Continue?
          </p>
          <div className={styles.confirmActions}>
            <Button size="sm" onClick={confirmSwap}>
              Switch concept
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPendingId(null)}>
              Keep current
            </Button>
          </div>
        </Panel>
      ) : null}

      {selected ? (
        <Panel tone="inverted" className={styles.pinned}>
          <div>
            <p className={styles.pinnedKicker}>Selected concept</p>
            <p className={styles.pinnedName}>{selected.proposal.name}</p>
            <p className={styles.pinnedIdea}>{selected.proposal.big_idea}</p>
          </div>
          <Button
            className={styles.pinnedCta}
            onClick={onBuildRecipe}
            loading={buildingRecipe}
            trailing="→"
          >
            {buildingRecipe ? "Assembling recipe…" : hasRecipe ? "Rebuild recipe" : "Build design recipe"}
          </Button>
        </Panel>
      ) : null}
    </section>
  );
}
