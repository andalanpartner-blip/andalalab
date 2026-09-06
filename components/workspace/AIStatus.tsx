"use client";

import styles from "./AIStatus.module.css";

/**
 * One id per real client-driven operation. There is no streaming from the API,
 * so the workspace shows one honest line for the whole operation — never a
 * fabricated "step 2 of 4" or a percentage the backend does not provide.
 */
export type AIStatusStep =
  | "interpreting-brief"
  | "clarifying-brief"
  | "building-recipe"
  | "applying-correction";

const STEP_COPY: Record<AIStatusStep, string> = {
  // the brief POST runs the interpreter and the concept engine in one call
  "interpreting-brief": "Interpreting the brief and generating concepts",
  "clarifying-brief": "Reading your answers and generating concepts",
  "building-recipe": "Assembling the design recipe",
  "applying-correction": "Applying the correction"
};

export type AIStatusProps = {
  /** null when idle. */
  readonly step: AIStatusStep | null;
  readonly inline?: boolean;
};

/**
 * A single honest line describing the operation actually running, announced via
 * an aria-live region. Idle renders an empty (but present) live region so the
 * next announcement is picked up reliably.
 */
export function AIStatus({ step, inline = false }: AIStatusProps) {
  return (
    <p
      className={inline ? `${styles.status} ${styles.inline}` : styles.status}
      role="status"
      aria-live="polite"
      data-active={step !== null || undefined}
    >
      {step ? (
        <>
          <span className={styles.pulse} aria-hidden="true" />
          <span>{STEP_COPY[step]}</span>
          <span className={styles.ellipsis} aria-hidden="true">
            …
          </span>
        </>
      ) : null}
    </p>
  );
}
