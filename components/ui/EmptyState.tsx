import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

export type EmptyStateProps = {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
  readonly compact?: boolean;
};

/** A calm placeholder for a stage that has nothing yet — not an error. */
export function EmptyState({ title, description, action, icon, compact = false }: EmptyStateProps) {
  return (
    <div className={compact ? `${styles.wrap} ${styles.compact}` : styles.wrap}>
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
