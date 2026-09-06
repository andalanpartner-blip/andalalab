import type { ReactNode } from "react";
import styles from "./Panel.module.css";

export type PanelTone = "reading" | "action" | "inverted";

export type PanelProps = {
  /** reading = calm surface; action = subtle accent edge; inverted = ink ground. */
  readonly tone?: PanelTone;
  /** Optional header rail across the top of the panel. */
  readonly header?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly padded?: boolean;
};

/**
 * The one bordered box. Hairline border, sharp corners, no shadow. `action`
 * adds a 3px accent edge so "you act here" reads differently from "the AI
 * decided this" without shouting.
 */
export function Panel({ tone = "reading", header, children, className, padded = true }: PanelProps) {
  return (
    <div className={[styles.panel, styles[tone], className].filter(Boolean).join(" ")}>
      {header ? <div className={styles.header}>{header}</div> : null}
      <div className={padded ? styles.body : undefined}>{children}</div>
    </div>
  );
}
