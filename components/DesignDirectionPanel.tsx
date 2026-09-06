import type { DirectionSummary } from "../services/pipeline.service";
import styles from "./DesignDirectionPanel.module.css";
import { Meter } from "./ui/Meter";
import { StageHeader } from "./ui/StageHeader";
import { humanize } from "../lib/format";

export function DesignDirectionPanel({ summary }: { summary: DirectionSummary }) {
  return (
    <section className={`container reveal ${styles.section}`} aria-labelledby="direction-heading">
      <StageHeader kicker="The art direction" title="Design Direction" id="direction-heading" />

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
          <Meter label="Hierarchy" ratio={summary.hierarchy_strength} emphasis />
          <Meter label="Whitespace" ratio={summary.whitespace} emphasis />
          <Meter label="Contrast" ratio={summary.contrast} emphasis />
        </div>
      </div>
    </section>
  );
}
