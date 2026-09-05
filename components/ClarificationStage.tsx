"use client";

import { useRef, useState } from "react";
import styles from "./ClarificationStage.module.css";
import type { ClarificationQuestion } from "../engine";

export type ClarificationStageProps = {
  readonly questions: readonly ClarificationQuestion[];
  readonly submitting: boolean;
  readonly onContinue: (answers: Record<string, string>) => void;
  readonly onStartOver: () => void;
};

export function ClarificationStage({
  questions,
  submitting,
  onContinue,
  onStartOver
}: ClarificationStageProps) {
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const headingRef = useRef<HTMLHeadingElement>(null);

  const allAnswered = answers.every((answer) => answer.trim().length > 0);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!allAnswered || submitting) return;
    const record: Record<string, string> = {};
    answers.forEach((answer, index) => {
      record[String(index)] = answer.trim();
    });
    onContinue(record);
  };

  return (
    <section className={`container reveal ${styles.wrap}`} aria-labelledby="clarify-heading">
      <p className={styles.kicker}>Before we continue</p>
      <h2 id="clarify-heading" ref={headingRef} className={styles.heading} tabIndex={-1}>
        {questions.length === 1
          ? "Before I design this, I need one quick decision."
          : `Before I design this, I need ${questions.length} quick decisions.`}
      </h2>

      <form onSubmit={handleSubmit}>
        <div className={styles.list}>
          {questions.map((item, index) => (
            <div className={styles.item} key={item.question}>
              <label className={styles.question} htmlFor={`clarify-${index}`}>
                {item.question}
              </label>
              <input
                id={`clarify-${index}`}
                className={styles.input}
                type="text"
                autoComplete="off"
                value={answers[index] ?? ""}
                disabled={submitting}
                onChange={(event) => {
                  const next = [...answers];
                  next[index] = event.target.value;
                  setAnswers(next);
                }}
              />
            </div>
          ))}
        </div>

        <div className={styles.actions}>
          <button type="submit" className={styles.continue} disabled={!allAnswered || submitting}>
            {submitting ? "Continuing…" : "Continue"}
            {!submitting && (
              <span aria-hidden="true">→</span>
            )}
          </button>
          <button type="button" className={styles.startOver} onClick={onStartOver} disabled={submitting}>
            Start over
          </button>
        </div>
      </form>
    </section>
  );
}
