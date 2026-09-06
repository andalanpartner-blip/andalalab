"use client";

import { useMemo, useState } from "react";
import { compilePromptSet, type PromptLanguage, type PromptSet } from "../engine";
import type { CreativeConcept } from "../types/schemas/concept.schema";
import type { DesignRecipe } from "../types/schemas/recipe.schema";
import { CopyButton } from "./ui/CopyButton";
import { Panel } from "./ui/Panel";
import { Disclosure } from "./ui/Disclosure";
import { StageHeader } from "./ui/StageHeader";
import { Badge } from "./ui/Badge";
import styles from "./PromptOutput.module.css";

export type PromptOutputProps = {
  readonly recipe: DesignRecipe;
  readonly concept: CreativeConcept | null;
};

type Copy = {
  readonly kicker: string;
  readonly title: string;
  readonly sub: string;
  readonly useThisOne: string;
  readonly moreFormats: string;
  readonly whatsNext: string;
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
    title: "Prompt",
    sub: "The full generation instruction, in your choice of language.",
    useThisOne: "Use this one",
    moreFormats: "More formats — Quick, Image-Only, Design/Layout, Negative",
    whatsNext:
      "Paste the master prompt into your image generator. When the Generation Adapter (P8) ships, you'll run it from the Generate stage and the render comes back into Review.",
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
    title: "Prompt",
    sub: "Instruksi generasi lengkap, dalam bahasa pilihan Anda.",
    useThisOne: "Pakai yang ini",
    moreFormats: "Format lain — Quick, Image-Only, Design/Layout, Negative",
    whatsNext:
      "Salin master prompt ke image generator Anda. Saat Generation Adapter (P8) hadir, Anda menjalankannya dari tahap Generate dan hasilnya kembali ke Review.",
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
    <Panel
      tone={dominant ? "inverted" : "reading"}
      padded={false}
      className={dominant ? styles.dominant : styles.card}
      header={
        <>
          <span className={styles.cardTitleWrap}>
            <h3 className={styles.cardTitle}>{title}</h3>
            {dominant ? (
              <Badge tone="accent" variant="soft">
                {copy.useThisOne}
              </Badge>
            ) : null}
          </span>
          <CopyButton
            text={text}
            label={copy.copyLabel}
            copiedLabel={copy.copiedLabel}
            variant={dominant ? "inverted" : "default"}
          />
        </>
      }
    >
      <pre className={styles.text}>{text}</pre>
    </Panel>
  );
}

/** Client-computed: the compiler is pure, so switching language is instant. */
export function PromptOutput({ recipe, concept }: PromptOutputProps) {
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
    <section className={`container ${styles.section}`} aria-labelledby="prompt-heading">
      <StageHeader
        kicker={copy.kicker}
        title={copy.title}
        id="prompt-heading"
        sub={copy.sub}
        aside={
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
        }
      />

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

      <div className={styles.masterBlock}>
        <PromptCard title={copy.master} text={promptSet.masterPrompt} copy={copy} dominant />
      </div>

      <Disclosure title={copy.moreFormats}>
        <div className={styles.moreBoard}>
          <PromptCard title={copy.quick} text={promptSet.quickPrompt} copy={copy} />
          <PromptCard title={copy.imageOnly} text={promptSet.imageOnlyPrompt} copy={copy} />
          <PromptCard title={copy.designLayout} text={promptSet.designLayoutPrompt} copy={copy} />
          <PromptCard title={copy.negative} text={promptSet.negativePrompt} copy={copy} />
        </div>
      </Disclosure>

      <p className={styles.whatsNext}>{copy.whatsNext}</p>
    </section>
  );
}
