import type { ReactNode } from "react";
import styles from "./Definition.module.css";

export function Definition({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
    </div>
  );
}

export function DefinitionGrid({ children, columns = "auto" }: { children: ReactNode; columns?: "auto" | "one" }) {
  return (
    <div className={columns === "one" ? `${styles.grid} ${styles.one}` : styles.grid}>{children}</div>
  );
}
