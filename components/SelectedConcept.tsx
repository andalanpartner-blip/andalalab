import type { CreativeConcept } from "../types/schemas/concept.schema";
import styles from "./SelectedConcept.module.css";
import { humanize } from "../lib/format";

export type SelectedConceptProps = {
  readonly concept: CreativeConcept;
  readonly onBuildRecipe: () => void;
  readonly buildingRecipe: boolean;
  readonly hasRecipe: boolean;
};

export function SelectedConcept({ concept, onBuildRecipe, buildingRecipe, hasRecipe }: SelectedConceptProps) {
  const { proposal } = concept;
  return (
    <section className={`container reveal ${styles.section}`} aria-labelledby="selected-heading">
      <p className={styles.kicker}>Selected Direction</p>
      <div className={styles.panel}>
        <div>
          <h2 id="selected-heading" className={styles.name}>
            {proposal.name}
          </h2>
          <p className={styles.bigIdea}>{proposal.big_idea}</p>
        </div>

        <div className={styles.list}>
          <div className={styles.item}>
            <span className={styles.label}>Visual metaphor</span>
            <span className={styles.value}>{proposal.visual_metaphor}</span>
          </div>
          <div className={styles.item}>
            <span className={styles.label}>Emotional direction</span>
            <span className={styles.value}>{humanize(proposal.emotional_direction)}</span>
          </div>
          <div className={styles.item}>
            <span className={styles.label}>Visual world</span>
            <span className={styles.value}>{proposal.visual_world}</span>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.buildButton} onClick={onBuildRecipe} disabled={buildingRecipe}>
          {buildingRecipe ? "Assembling recipe…" : hasRecipe ? "Rebuild Design Recipe" : "Build Design Recipe"}
          {!buildingRecipe && <span aria-hidden="true">→</span>}
        </button>
      </div>
    </section>
  );
}
