"use client";

import { useMemo, useState } from "react";
import { compilePromptSet, type PromptLanguage, type PromptSet } from "../engine";
import type { CreativeConcept } from "../types/schemas/concept.schema";
import type { DesignRecipe } from "../types/schemas/recipe.schema";
import { CopyButton } from "./ui/CopyButton";
import styles from "./PromptSection.module.css";

export type PromptSectionProps = {
  readonly recipe: DesignRecipe;
  readonly concept: CreativeConcept | null;
};

type Copy = {
  readonly kicker: string;
  readonly title: string;
  readonly sub: string;
  readonly visualCharacterLabel: string;
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly master: string;
  readonly quick: string;
  readonly imageOnly: string;
  readonly designLayout: string;
  readonly negative: string;
};

type GuardCopy = { readonly label: string; readonly stripped: (n: number) => string; readonly flagged: (n: number) => string };

const COPY: Record<PromptLanguage, Copy & { readonly guard: GuardCopy }> = {
  en: {
    kicker: "Ready to generate",
    title: "Prompt for Visual Generation",
    sub: "Copy the prompt below and use it in your preferred image generator.",
    visualCharacterLabel: "Visual character",
    copyLabel: "Copy",
    copiedLabel: "Copied",
    master: "Master Prompt",
    quick: "Quick Prompt",
    imageOnly: "Image-Only Prompt",
    designLayout: "Design / Layout Prompt",
    negative: "Negative Prompt",
    guard: {
      label: "Stereotype guard",
      stripped: (n) => `${n} guarded motif ${n === 1 ? "mention" : "mentions"} removed from a positive list.`,
      flagged: (n) =>
        `${n} guarded motif ${n === 1 ? "mention was" : "mentions were"} left in place — each sits inside an “avoid / no” instruction, so the prompt is telling the generator NOT to use it.`
    }
  },
  id: {
    kicker: "Siap digunakan",
    title: "Prompt untuk Generasi Visual",
    sub: "Salin prompt di bawah dan gunakan di image generator pilihan Anda.",
    visualCharacterLabel: "Karakter visual",
    copyLabel: "Salin",
    copiedLabel: "Tersalin",
    master: "Master Prompt",
    quick: "Quick Prompt",
    imageOnly: "Image-Only Prompt",
    designLayout: "Design / Layout Prompt",
    negative: "Negative Prompt",
    guard: {
      label: "Penjaga stereotip",
      stripped: (n) => `${n} penyebutan motif terjaga dihapus dari daftar positif.`,
      flagged: (n) =>
        `${n} penyebutan motif terjaga dibiarkan — semuanya berada di dalam instruksi “hindari / jangan”, jadi prompt justru menyuruh generator untuk TIDAK memakainya.`
    }
  }
};

function PromptCard({
  title,
  text,
  copy,
  dominant = false
}: {
  title: string;
  text: string;
  copy: Copy;
  dominant?: boolean;
}) {
  return (
    <div className={dominant ? `${styles.card} ${styles.dominant}` : styles.card}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{title}</h3>
        <CopyButton
          text={text}
          label={copy.copyLabel}
          copiedLabel={copy.copiedLabel}
          variant={dominant ? "inverted" : "default"}
        />
      </div>
      <pre className={styles.text}>{text}</pre>
    </div>
  );
}

/** Client-computed: the compiler is pure and deterministic, so switching language is instant and needs no round trip. */
export function PromptSection({ recipe, concept }: PromptSectionProps) {
  const [language, setLanguage] = useState<PromptLanguage>("en");
  const promptSet: PromptSet = useMemo(
    () => compilePromptSet({ recipe, concept, language }),
    [recipe, concept, language]
  );
  const copy = COPY[language];

  const guard = promptSet.guard;
  const strippedTokens = new Set(guard.findings.filter((f) => f.action === "stripped").map((f) => f.token));
  const flaggedTokens = new Set(guard.findings.filter((f) => f.action === "flagged").map((f) => f.token));
  const flaggedContexts = [...new Set(guard.findings.filter((f) => f.action === "flagged").map((f) => f.context))];

  return (
    <section className={`container reveal ${styles.section}`} aria-labelledby="prompt-heading">
      <div className={styles.head}>
        <p className={styles.kicker}>{copy.kicker}</p>
        <div className={styles.titleRow}>
          <h2 id="prompt-heading" className={styles.title}>
            {copy.title}
          </h2>
          <div className={styles.langSwitch} role="group" aria-label="Prompt language">
            <button
              type="button"
              className={language === "en" ? `${styles.langButton} ${styles.langActive}` : styles.langButton}
              aria-pressed={language === "en"}
              onClick={() => setLanguage("en")}
            >
              English
            </button>
            <button
              type="button"
              className={language === "id" ? `${styles.langButton} ${styles.langActive}` : styles.langButton}
              aria-pressed={language === "id"}
              onClick={() => setLanguage("id")}
            >
              Bahasa Indonesia
            </button>
          </div>
        </div>
        <p className={styles.sub}>{copy.sub}</p>
        <p className={styles.visualCharacter}>
          <span className={styles.visualCharacterKicker}>{copy.visualCharacterLabel}</span>
          <span className={styles.visualCharacterValue}>{promptSet.visualCharacter.label}</span>
          <span className={styles.visualCharacterDesc}>{promptSet.visualCharacter.description}</span>
        </p>

        {!guard.clean ? (
          <div className={styles.guardNote}>
            <span className={styles.guardNoteLabel}>{copy.guard.label}</span>{" "}
            {strippedTokens.size > 0 ? copy.guard.stripped(strippedTokens.size) : null}{" "}
            {flaggedTokens.size > 0 ? copy.guard.flagged(flaggedTokens.size) : null}
            {flaggedContexts.length > 0 ? (
              <ul>
                {flaggedContexts.map((context) => (
                  <li key={context}>
                    <code>{context}</code>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={styles.board}>
        <PromptCard title={copy.master} text={promptSet.masterPrompt} copy={copy} dominant />
        <PromptCard title={copy.quick} text={promptSet.quickPrompt} copy={copy} />
        <PromptCard title={copy.imageOnly} text={promptSet.imageOnlyPrompt} copy={copy} />
        <PromptCard title={copy.designLayout} text={promptSet.designLayoutPrompt} copy={copy} />
        <PromptCard title={copy.negative} text={promptSet.negativePrompt} copy={copy} />
      </div>
    </section>
  );
}
