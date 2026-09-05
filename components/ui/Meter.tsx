import type { CSSProperties } from "react";
import styles from "./Meter.module.css";
import { percent, ratioLabel } from "../../lib/format";

export type MeterProps = {
  readonly label: string;
  readonly ratio: number;
};

/** A single 0..1 design parameter, shown as a short bar plus a plain-language reading. */
export function Meter({ label, ratio }: MeterProps) {
  const clamped = Math.min(1, Math.max(0, ratio));
  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>
          {ratioLabel(clamped)} · {percent(clamped)}
        </span>
      </div>
      <div
        className={styles.track}
        role="img"
        aria-label={`${label}: ${ratioLabel(clamped)}, ${percent(clamped)}`}
      >
        <span
          className={styles.fill}
          style={{ "--meter-value": percent(clamped) } as CSSProperties}
        />
      </div>
    </div>
  );
}
