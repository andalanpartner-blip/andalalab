"use client";

import { useRef } from "react";
import styles from "./BriefStage.module.css";
import { Button } from "./ui/Button";

const CHIPS: readonly { label: string; starter: string }[] = [
  { label: "Grand Opening", starter: "Buat materi promosi grand opening untuk " },
  { label: "Product Launch", starter: "Buat materi peluncuran produk baru untuk " },
  { label: "Social Campaign", starter: "Buat kampanye media sosial untuk " },
  { label: "Event Poster", starter: "Buat poster acara untuk " }
];

const PLACEHOLDER =
  "Contoh: Buat poster Instagram 4:5 untuk coffee shop baru di Solo. Target anak muda, ingin tampil modern dengan sedikit nuansa Jepang. Fokus untuk grand opening.";

const MAX_LENGTH = 2400;

export type BriefStageProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly submitting: boolean;
};

export function BriefStage({ value, onChange, onSubmit, submitting }: BriefStageProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const applyChip = (starter: string) => {
    const next = value.trim().length === 0 ? starter : `${value.trim()} ${starter}`;
    onChange(next);
    const node = textareaRef.current;
    if (node) {
      node.focus();
      requestAnimationFrame(() => node.setSelectionRange(next.length, next.length));
    }
  };

  const canSubmit = value.trim().length > 0 && !submitting;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <section className={`container ${styles.hero}`} aria-labelledby="brief-heading">
      <p className={styles.eyebrow}>Start a new brief</p>
      <h1 id="brief-heading" className={styles.heading}>
        What are we designing today?
      </h1>
      <p className={styles.sub}>Describe the campaign, product, audience, or visual you have in mind.</p>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit();
        }}
      >
        <label htmlFor="brief-input" className="visually-hidden">
          Describe your design brief
        </label>
        <div className={styles.fieldWrap}>
          <textarea
            id="brief-input"
            ref={textareaRef}
            className={styles.textarea}
            placeholder={PLACEHOLDER}
            value={value}
            maxLength={MAX_LENGTH}
            disabled={submitting}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className={styles.footerRow}>
            <span className={styles.hint}>⌘/Ctrl + Enter to analyze</span>
            <span className={styles.count} aria-hidden="true">
              {value.length}/{MAX_LENGTH}
            </span>
          </div>
        </div>

        <div className={styles.chipRow} role="group" aria-label="Suggested brief starters">
          {CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              className={styles.chip}
              onClick={() => applyChip(chip.starter)}
              disabled={submitting}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className={styles.actions}>
          <Button
            type="submit"
            disabled={value.trim().length === 0}
            loading={submitting}
            trailing="→"
          >
            {submitting ? "Reading your brief…" : "Analyze Brief"}
          </Button>
        </div>
      </form>
    </section>
  );
}
