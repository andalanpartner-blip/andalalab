import styles from "./StatusDot.module.css";

export type DotState = "done" | "active" | "available" | "future" | "blocked";

export type StatusDotProps = {
  readonly state: DotState;
  readonly label?: string;
  readonly size?: "sm" | "md";
};

/**
 * One dot, five honest states. Used by the stage rail and anywhere a step's
 * status needs a glyph. `active` is the only one that carries the accent.
 */
export function StatusDot({ state, label, size = "md" }: StatusDotProps) {
  return (
    <span
      className={`${styles.dot} ${styles[state]} ${styles[size]}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
