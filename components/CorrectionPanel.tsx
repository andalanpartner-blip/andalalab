"use client";

import { useMemo, useState } from "react";
import type { DesignRecipe } from "../types/schemas/recipe.schema";
import type { DesignContract } from "../types/schemas/contract.schema";
import type { DesignDirection } from "../types/schemas/direction.schema";
import type { CreativeConcept } from "../types/schemas/concept.schema";
import type { CorrectionField, CorrectionReport, DesignCriticReport } from "../engine";
import styles from "./CorrectionPanel.module.css";
import { titleCase } from "../lib/format";
import { StageHeader } from "./ui/StageHeader";
import { Field, Select, Input } from "./ui/Field";
import { Button } from "./ui/Button";
import { Badge, type BadgeTone } from "./ui/Badge";

/** The bounded P6 correction surface, grouped for the picker. */
const FIELDS: { group: string; fields: CorrectionField[] }[] = [
  {
    group: "DKV parameters",
    fields: [
      "whitespace",
      "contrast",
      "visual_density",
      "alignment",
      "hierarchy_strength",
      "color_complexity",
      "focal_dominance",
      "typographic_scale_ratio"
    ]
  },
  {
    group: "Colour · lighting · material · ornament",
    fields: ["color_saturation", "imagery_realism", "materiality_texture", "graphic_ornament"]
  }
];

type OkResult = {
  status: "OK";
  outcome: "adjustment";
  correction: CorrectionReport;
  recipe: DesignRecipe;
  contract: DesignContract;
  direction: DesignDirection;
  critic: DesignCriticReport;
};
type RejectedResult = { status: "REDESIGN" | "NOOP"; correction: CorrectionReport };
type FailureResult = { status: "ERROR"; message: string };
type CorrectionResult = OkResult | RejectedResult | FailureResult;

export type CorrectionPanelProps = {
  readonly recipe: DesignRecipe;
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly concept: CreativeConcept | null;
  readonly onCorrected: (next: {
    recipe: DesignRecipe;
    contract: DesignContract;
    direction: DesignDirection;
    critic: DesignCriticReport;
  }) => void;
};

const VERDICT_COPY: Record<CorrectionReport["outcome"], string> = {
  adjustment: "Adjustment applied",
  redesign: "That is a redesign, not a correction",
  noop: "Nothing changed"
};

const OUTCOME_TONE: Record<CorrectionReport["outcome"], BadgeTone> = {
  adjustment: "ok",
  redesign: "attention",
  noop: "neutral"
};

export function CorrectionPanel({ recipe, contract, direction, concept, onCorrected }: CorrectionPanelProps) {
  const [field, setField] = useState<CorrectionField>("whitespace");
  const [mode, setMode] = useState<"set" | "increase" | "decrease">("increase");
  const [amount, setAmount] = useState(0.05);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CorrectionResult | null>(null);

  const currentValue = useMemo(() => {
    if (field === "color_saturation") return recipe.color.saturation;
    if (field === "imagery_realism") return recipe.imagery.realism;
    if (field === "materiality_texture") return recipe.materiality.texture;
    if (field === "graphic_ornament") return recipe.graphic_language.ornament;
    return recipe.dkv[field as keyof typeof recipe.dkv];
  }, [field, recipe]);

  const submit = async () => {
    setBusy(true);
    setResult(null);
    const response = await fetch("/api/correction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentRecipe: recipe,
        contract,
        direction,
        concept,
        patch: { adjustments: [{ field, mode, amount }] }
      })
    });
    const data = (await response.json()) as CorrectionResult;
    setResult(data);
    if (data.status === "OK") {
      onCorrected({ recipe: data.recipe, contract: data.contract, direction: data.direction, critic: data.critic });
    }
    setBusy(false);
  };

  return (
    <section className={`container reveal ${styles.section}`} aria-labelledby="correction-heading">
      <StageHeader
        kicker="P6 — deterministic, no AI"
        title="Correction"
        id="correction-heading"
        sub="Nudge the measurable design parameters and a few biases. Anything that would change the movement, layout, composition, concept, objective or message is a new direction, not a correction."
      />

      <div className={styles.controls}>
        <Field label="Field" htmlFor="correction-field">
          <Select
            id="correction-field"
            value={field}
            onChange={(e) => setField(e.target.value as CorrectionField)}
          >
            {FIELDS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.fields.map((f) => (
                  <option key={f} value={f}>
                    {titleCase(f)}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        <Field label="Change" htmlFor="correction-mode">
          <Select
            id="correction-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="increase">Increase by</option>
            <option value="decrease">Decrease by</option>
            <option value="set">Set to</option>
          </Select>
        </Field>

        <Field label="Amount" htmlFor="correction-amount">
          <Input
            id="correction-amount"
            type="number"
            step={0.05}
            min={0}
            max={field === "typographic_scale_ratio" ? 4 : 1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </Field>

        <div className={styles.applyCell}>
          <Button type="button" onClick={() => void submit()} loading={busy}>
            {busy ? "Applying…" : "Apply correction"}
          </Button>
        </div>
      </div>

      <p className={styles.current}>
        Current {titleCase(field)}: <strong>{currentValue.toFixed(3)}</strong>
      </p>

      {result ? (
        <div className={`${styles.result} ${styles[`result_${result.status}`]}`}>
          {result.status === "ERROR" ? (
            <p className={styles.resultReason}>{result.message}</p>
          ) : (
            <>
              <p className={styles.resultHead}>
                <Badge tone={OUTCOME_TONE[result.correction.outcome]} variant="soft">
                  {VERDICT_COPY[result.correction.outcome]}
                </Badge>
              </p>
              <p className={styles.resultReason}>{result.correction.reason}</p>
              {result.correction.changes.length > 0 ? (
                <ul className={styles.changeList}>
                  {result.correction.changes.map((c) => (
                    <li key={c.field}>
                      {titleCase(c.field)}: requested {c.requested.toFixed(3)} → resolved {c.resolved.toFixed(3)}
                      {c.held_by ? ` (held by ${c.held_by})` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              {result.status === "OK" ? (
                <p className={styles.resultReason}>
                  New Design Review verdict: <strong>{result.critic.verdict}</strong>. The recipe and prompt
                  above have been updated.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
