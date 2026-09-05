import type { ReactNode } from "react";
import styles from "./Tag.module.css";

export function Tag({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" }) {
  return (
    <span className={tone === "accent" ? `${styles.tag} ${styles.accent}` : styles.tag}>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </span>
  );
}
