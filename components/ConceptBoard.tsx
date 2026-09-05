import type { CreativeConcept } from "../types/schemas/concept.schema";
import styles from "./ConceptBoard.module.css";
import { humanize, percent } from "../lib/format";

export type ConceptBoardProps = {
  readonly concepts: readonly CreativeConcept[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
};

export function ConceptBoard({ concepts, selectedId, onSelect }: ConceptBoardProps) {
  return (
    <section className={`container reveal ${styles.section}`} aria-labelledby="concepts-heading">
      <div className={styles.head}>
        <p className={styles.kicker}>Three directions, one strategic idea</p>
        <h2 id="concepts-heading" className={styles.title}>
          Creative Concepts
        </h2>
        <p className={styles.sub}>Choose the direction that should carry through to the design recipe.</p>
      </div>

      <div className={styles.grid}>
        {concepts.map((concept, index) => {
          const selected = concept.id === selectedId;
          return (
            <button
              key={concept.id}
              type="button"
              aria-pressed={selected}
              aria-label={`${concept.proposal.name}${selected ? " (selected)" : ""}`}
              className={styles.card}
              data-selected={selected}
              onClick={() => onSelect(concept.id)}
            >
              <div className={styles.cardTop}>
                <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
                {selected ? (
                  <span className={styles.selectedMark}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M5 12.5 10 17l9-10"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Selected
                  </span>
                ) : (
                  <span className={styles.score}>{percent(concept.score.total)} fit</span>
                )}
              </div>

              <div>
                <h3 className={styles.name}>{concept.proposal.name}</h3>
                <p className={styles.type}>{humanize(concept.proposal.type)}</p>
              </div>

              <div className={styles.field}>
                <span className={styles.fieldLabel}>Big idea</span>
                <span className={`${styles.fieldValue} ${styles.strong}`}>{concept.proposal.big_idea}</span>
              </div>

              <div className={styles.field}>
                <span className={styles.fieldLabel}>Visual metaphor</span>
                <span className={styles.fieldValue}>{concept.proposal.visual_metaphor}</span>
              </div>

              <div className={styles.field}>
                <span className={styles.fieldLabel}>Why it works</span>
                <span className={styles.fieldValue}>{concept.proposal.why}</span>
              </div>

              <p className={styles.risk}>Risk: {concept.proposal.risk}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
