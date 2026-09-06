"use client";

import styles from "./AIStatus.module.css";

export type AIStatusStep =
  | "interpreting-brief"
  | "clarifying-brief"
  | "generating-concepts"
  | "resolving-strategy"
  | "building-recipe"
  | "preparing-prompt"
  | "applying-correction";

const STEP_COPY: Record<AIStatusStep, string> = {
  "interpreting-brief": "Interpreting the brief",
  "clarifying-brief": "Reading your answers",
  "generating-concepts": "Generating three concepts",
  "resolving-strategy": "Resolving the strategy",
  "building-recipe": "Building the design recipe",
  "preparing-prompt": "Preparing the prompt",
  "applying-correction": "Applying the correction"
};

export type AIStatusProps = {
  /** null when idle. */
  readonly step: AIStatusStep | null;
  readonly inline?: boolean;
};

/**
 * A single honest line describing the operation actually running. It never
 * claims a percentage the pipeline does not provide. Announced via aria-live.
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
          {STEP_COPY[step]}
          <span className={styles.ellipsis} aria-hidden="true">
            …
          </span>
        </>
      ) : (
        <span className="visually-hidden">Idle</span>
      )}
    </p>
  );
}
