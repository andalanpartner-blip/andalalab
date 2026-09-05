import type { ReactNode } from "react";
import styles from "./Collapsible.module.css";

export type CollapsibleProps = {
  readonly title: string;
  readonly hint?: string;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
};

/** A native <details> accordion section — free keyboard support, no JS needed. */
export function Collapsible({ title, hint, defaultOpen = false, children }: CollapsibleProps) {
  return (
    <details className={styles.details} open={defaultOpen}>
      <summary className={styles.summary}>
        <span className={styles.summaryLeft}>
          <span className={styles.title}>{title}</span>
          {hint ? <span className={styles.hint}>{hint}</span> : null}
        </span>
        <svg className={styles.chevron} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className={styles.content}>{children}</div>
    </details>
  );
}
