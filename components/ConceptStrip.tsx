import type { CreativeConcept } from "../types/schemas/concept.schema";
import styles from "./ConceptStrip.module.css";
import { humanize } from "../lib/format";

/** A quiet one-line reminder of the concept carrying through the current stage. */
export function ConceptStrip({
  concept,
  onEdit
}: {
  concept: CreativeConcept;
  onEdit?: () => void;
}) {
  return (
    <div className={`container ${styles.strip}`}>
      <span className={styles.kicker}>Concept</span>
      <span className={styles.name}>{concept.proposal.name}</span>
      <span className={styles.type}>{humanize(concept.proposal.type)}</span>
      {onEdit ? (
        <button type="button" className={styles.edit} onClick={onEdit}>
          Change
        </button>
      ) : null}
    </div>
  );
}
