import type { ReactNode } from "react";
import styles from "./Badge.module.css";

export type BadgeTone = "neutral" | "ok" | "attention" | "critical" | "accent";
export type BadgeVariant = "solid" | "soft" | "outline";

export type BadgeProps = {
  readonly tone?: BadgeTone;
  readonly variant?: BadgeVariant;
  /** Leading status dot (the old Tag look). */
  readonly dot?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
};

/**
 * The one small label. Tone is SEMANTIC (neutral / ok / attention / critical /
 * accent). Metadata and confidence use `neutral` — they never borrow the
 * accent or a status colour.
 */
export function Badge({ tone = "neutral", variant = "soft", dot = false, children, className }: BadgeProps) {
  return (
    <span
      className={[styles.badge, styles[tone], styles[variant], className].filter(Boolean).join(" ")}
    >
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
