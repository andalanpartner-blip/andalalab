import type { DirectionSummary } from "../services/pipeline.service";
import styles from "./DesignDirectionPanel.module.css";
import { Meter } from "./ui/Meter";
import { humanize } from "../lib/format";

export function DesignDirectionPanel({ summary }: { summary: DirectionSummary }) {
  return (
    <section className={`container reveal ${styles.section}`} aria-labelledby="direction-heading">
      <p className={styles.kicker}>The art direction</p>
      <h2 id="direction-heading" className={styles.title}>
        Design Direction
      </h2>

      <div className={styles.board}>
        <div className={styles.left}>
          <div className={styles.row}>
            <span className={styles.label}>Design Movement</span>
            <span className={styles.value}>{summary.movement}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Layout</span>
            <span className={styles.value}>{summary.layout}</span>
            <span className={styles.sub}>{humanize(summary.composition)} composition</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Visual Tone</span>
            <span className={styles.value}>{humanize(summary.visual_tone)}</span>
            <span className={styles.sub}>{humanize(summary.typography)} type system</span>
          </div>
        </div>
        <div className={styles.right}>
          <Meter label="Hierarchy" ratio={summary.hierarchy_strength} />
          <Meter label="Whitespace" ratio={summary.whitespace} />
          <Meter label="Contrast" ratio={summary.contrast} />
        </div>
      </div>
    </section>
  );
}
