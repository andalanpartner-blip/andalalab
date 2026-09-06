import styles from "./Skeleton.module.css";

export type SkeletonProps = {
  readonly variant?: "line" | "block" | "panel";
  /** Number of lines (variant="line" only). */
  readonly lines?: number;
  readonly width?: string;
  readonly height?: string;
  readonly className?: string;
};

/**
 * A genuine loading placeholder. Used only where content is actually being
 * fetched — never as decoration. Shimmer is suppressed under reduced-motion.
 */
export function Skeleton({ variant = "line", lines = 3, width, height, className }: SkeletonProps) {
  if (variant === "line") {
    return (
      <div className={[styles.stack, className].filter(Boolean).join(" ")} aria-hidden="true">
        {Array.from({ length: lines }).map((_, index) => (
          <span
            key={index}
            className={styles.line}
            style={{ width: index === lines - 1 ? "62%" : width ?? "100%" }}
          />
        ))}
      </div>
    );
  }
  return (
    <span
      className={[variant === "panel" ? styles.panel : styles.block, className].filter(Boolean).join(" ")}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
