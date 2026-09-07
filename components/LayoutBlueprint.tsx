"use client";

import { useState, type ReactNode } from "react";
import type { LayoutBlueprint as LayoutBlueprintType } from "../types/schemas/layout-blueprint.schema";
import type { StageId } from "../lib/workspace";
import {
  blueprintMetrics,
  blueprintZoneRows,
  focalZoneLabel,
  isBlueprintStale,
  readingSequence
} from "../lib/blueprint-view";
import { BlueprintCanvas } from "./blueprint/BlueprintCanvas";
import { StageHeader } from "./ui/StageHeader";
import { Button } from "./ui/Button";
import { Disclosure } from "./ui/Disclosure";
import styles from "./LayoutBlueprint.module.css";

/**
 * The Layout stage — a read-only, premium view of the already-resolved
 * `LayoutBlueprint`. It renders the schematic, the zone legend, the reading
 * order, a little metadata and the deterministic "why this layout?" rationale.
 * It computes nothing: every value shown comes straight off the blueprint.
 */

export type LayoutBlueprintProps = {
  readonly blueprint: LayoutBlueprintType;
  /** The hash of the recipe currently held by the page — for the stale check. */
  readonly recipeHash: string;
  readonly onNavigate: (stage: StageId) => void;
  /** P2.10 additive — the nine visual layout templates explorer, slotted before the actions. */
  readonly templates?: ReactNode;
};

export function LayoutBlueprint({ blueprint, recipeHash, onNavigate, templates }: LayoutBlueprintProps) {
  const [highlightZone, setHighlightZone] = useState<string | null>(null);
  const stale = isBlueprintStale(blueprint, recipeHash);
  const metrics = blueprintMetrics(blueprint);
  const zoneRows = blueprintZoneRows(blueprint);
  const sequence = readingSequence(blueprint);

  return (
    <section className={`container ${styles.section}`} aria-labelledby="layout-heading">
      <StageHeader
        kicker="Stage 5 · the layout blueprint"
        title="Design Blueprint"
        id="layout-heading"
        sub="How the AI intends to organise the surface before the image is generated — intended structure, not pixel-final artwork."
      />

      {stale ? (
        <div className={styles.stale} role="status">
          <p className={styles.staleTitle}>This blueprint is out of date.</p>
          <p className={styles.staleBody}>
            It was generated from an earlier recipe version. Rebuild the recipe to refresh the
            layout.
          </p>
          <Button variant="secondary" size="sm" onClick={() => onNavigate("recipe")}>
            Go to the recipe
          </Button>
        </div>
      ) : null}

      <div className={styles.split}>
        <div className={styles.canvasCol}>
          <BlueprintCanvas blueprint={blueprint} highlightZone={highlightZone} />
          <p className={styles.readingLine}>
            <span className={styles.readingLabel}>Reading order</span>
            {sequence.map((step) => (
              <span key={step.zone} className={styles.readingStep}>
                <span className={styles.readingNum}>{step.step}</span>
                {step.label}
              </span>
            ))}
          </p>
        </div>

        <aside className={styles.why} aria-labelledby="why-heading">
          <h3 id="why-heading" className={styles.whyHeading}>
            Why this layout?
          </h3>
          <ol className={styles.rationale}>
            {blueprint.rationale.map((entry, index) => (
              <li key={index} className={styles.rationaleItem}>
                <p className={styles.claim}>{entry.claim}</p>
                <p className={styles.reason}>{entry.reason}</p>
                {entry.principle ? (
                  <p className={styles.principle}>
                    <span className={styles.principleLabel}>Principle</span>
                    {entry.principle}
                  </p>
                ) : null}
                <Disclosure title="Basis">
                  <ul className={styles.basisList}>
                    {entry.basis.map((b) => (
                      <li key={b}>{b.replace(/_/g, " ")}</li>
                    ))}
                  </ul>
                  <p className={styles.signal}>{entry.signal}</p>
                </Disclosure>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <dl className={styles.metrics}>
        {metrics.map((m) => (
          <div key={m.label} className={styles.metric}>
            <dt>{m.label}</dt>
            <dd>{m.value}</dd>
          </div>
        ))}
      </dl>

      <div className={styles.zones}>
        <h3 className={styles.zonesHeading}>Zones</h3>
        <ul className={styles.zoneList}>
          {zoneRows.map((zone) => (
            <li
              key={zone.id}
              className={styles.zoneRow}
              id={`zone-row-${zone.id}`}
              onMouseEnter={() => setHighlightZone(zone.id)}
              onMouseLeave={() => setHighlightZone(null)}
              onFocus={() => setHighlightZone(zone.id)}
              onBlur={() => setHighlightZone(null)}
              tabIndex={0}
              aria-label={`${zone.label}: rank ${zone.rank}, ${zone.roleLabel} role, ${zone.areaPct} of the surface, ${
                zone.required ? "required" : "optional"
              }${zone.withinSafeArea ? "" : ", reaches the safe-area edge"}`}
            >
              <span className={styles.zoneRank}>{zone.rank}</span>
              <span className={styles.zoneName}>{zone.label}</span>
              <span className={styles.zoneRole} data-role={zone.role}>
                {zone.roleLabel}
              </span>
              <span className={styles.zoneArea}>{zone.areaPct}</span>
              <span
                className={styles.zoneReq}
                data-required={zone.required || undefined}
              >
                <span className={styles.zoneReqSwatch} aria-hidden="true" />
                {zone.required ? "Required" : "Optional"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {templates}

      <div className={styles.actions}>
        <Button onClick={() => onNavigate("prompt")} trailing="→">
          Continue to the prompt
        </Button>
        <Button variant="secondary" onClick={() => onNavigate("recipe")}>
          Back to the recipe
        </Button>
      </div>
    </section>
  );
}

/** The compliance-style back-link shown on the Prompt stage. */
export function LayoutBackLink({
  blueprint,
  onOpen
}: {
  blueprint: LayoutBlueprintType;
  onOpen: () => void;
}) {
  const n = blueprint.zones.length;
  return (
    <button type="button" className={styles.backLink} onClick={onOpen}>
      <span className={styles.backLinkText}>
        Layout: {n} zone{n === 1 ? "" : "s"} · focal on {focalZoneLabel(blueprint).toLowerCase()}
      </span>
      <span className={styles.backLinkOpen}>See the layout →</span>
    </button>
  );
}
