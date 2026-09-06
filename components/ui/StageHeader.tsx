import type { ReactNode } from "react";
import styles from "./StageHeader.module.css";

export type StageHeaderProps = {
  readonly kicker?: ReactNode;
  readonly title: ReactNode;
  readonly id?: string;
  readonly sub?: ReactNode;
  /** Right-aligned slot — e.g. AIStatus, a language switch, a compliance chip. */
  readonly aside?: ReactNode;
  /** A quiet line under the title, e.g. "What changed: whitespace 48% → 52%". */
  readonly changed?: ReactNode;
  readonly size?: "section" | "stage";
};

/**
 * The one section/stage header: kicker → title → optional sub, with an aside
 * slot and a "what changed" line. Replaces the hand-rolled kicker/title/sub
 * trio that every section carried.
 */
export function StageHeader({
  kicker,
  title,
  id,
  sub,
  aside,
  changed,
  size = "section"
}: StageHeaderProps) {
  return (
    <div className={`${styles.head} ${styles[size]}`}>
      <div className={styles.main}>
        {kicker ? <p className={styles.kicker}>{kicker}</p> : null}
        <h2 id={id} className={styles.title}>
          {title}
        </h2>
        {sub ? <p className={styles.sub}>{sub}</p> : null}
        {changed ? <p className={styles.changed}>{changed}</p> : null}
      </div>
      {aside ? <div className={styles.aside}>{aside}</div> : null}
    </div>
  );
}
