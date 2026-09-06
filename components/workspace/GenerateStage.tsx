"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./GenerateStage.module.css";
import { StageHeader } from "../ui/StageHeader";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Disclosure } from "../ui/Disclosure";
import type { StageId } from "../../lib/workspace";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type { LayoutBlueprint } from "../../types/schemas/layout-blueprint.schema";
import type {
  GeneratedArtifact,
  GenerationRequest
} from "../../types/schemas/visual-generation.schema";
import type { GenerationEstimate, GenerationIssueCode } from "../../ports/visual-generation.port";
import {
  artifactRows,
  formatEstimatedCost,
  generationErrorMessage,
  layoutContextLabel,
  nextGenerateState,
  previewRows,
  promptContextLabel,
  provenanceRows,
  type GenerateState
} from "../../lib/generate-view";

/**
 * The Generate stage — an explicit, cost-confirmed production action.
 *
 * Entering the stage runs a PREVIEW (build the request + estimate its cost) —
 * never the provider. Generation happens only when the user clicks
 * "Generate visual". The `GeneratedArtifact` the server returns is the source
 * of truth; this component computes nothing about the design.
 */

type PostBody = {
  action: "preview" | "generate";
  recipe: DesignRecipe;
  contract: DesignContract;
  concept: CreativeConcept | null;
  blueprint: LayoutBlueprint | null;
  promptLanguage: "en" | "id";
};

type PreviewResponse =
  | { status: "OK"; request: GenerationRequest; estimate: GenerationEstimate }
  | { status: "ERROR"; message: string };

type GenerateResponse =
  | { status: "OK"; request: GenerationRequest; artifact: GeneratedArtifact; imageDataUrl?: string }
  | { status: "ERROR"; message: string; issues?: { code: GenerationIssueCode; message: string }[] };

export type GenerateStageProps = {
  readonly recipe: DesignRecipe;
  readonly contract: DesignContract;
  readonly concept: CreativeConcept | null;
  readonly blueprint: LayoutBlueprint | null;
  readonly promptLanguage?: "en" | "id";
  readonly onNavigate: (stage: StageId) => void;
};

export function GenerateStage({
  recipe,
  contract,
  concept,
  blueprint,
  promptLanguage = "en",
  onNavigate
}: GenerateStageProps) {
  const [state, setState] = useState<GenerateState>("previewing");
  const [preview, setPreview] = useState<{ request: GenerationRequest; estimate: GenerationEstimate } | null>(null);
  const [result, setResult] = useState<{ artifact: GeneratedArtifact; imageDataUrl?: string } | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<GenerationIssueCode | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const generatingRef = useRef(false);

  const body = useCallback(
    (action: "preview" | "generate"): PostBody => ({
      action,
      recipe,
      contract,
      concept,
      blueprint,
      promptLanguage
    }),
    [recipe, contract, concept, blueprint, promptLanguage]
  );
  // Keep the latest body without making it an effect dependency — the preview
  // must re-run only when the DESIGN changes (its recipe hash), not on every
  // parent re-render (which passes fresh `concept` / `selectedConcept` refs).
  const bodyRef = useRef(body);
  bodyRef.current = body;

  // Cost-confirmation preview on entry — this never calls the provider.
  useEffect(() => {
    let cancelled = false;
    setState("previewing");
    setPreview(null);
    setResult(null);
    setErrorText(null);
    setErrorCode(null);
    (async () => {
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyRef.current("preview"))
        });
        const data = (await res.json()) as PreviewResponse;
        if (cancelled) return;
        if (data.status === "OK") {
          setPreview({ request: data.request, estimate: data.estimate });
          setState((s) => nextGenerateState(s, { type: "preview_ok" }));
        } else {
          setErrorText(data.message);
          setState((s) => nextGenerateState(s, { type: "preview_error" }));
        }
      } catch {
        if (cancelled) return;
        setErrorText("The generation preview could not be loaded.");
        setState((s) => nextGenerateState(s, { type: "preview_error" }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recipe.recipe_hash, promptLanguage]);

  useEffect(() => {
    if (state === "success" || state === "error") resultHeadingRef.current?.focus();
  }, [state]);

  const generate = useCallback(async () => {
    if (generatingRef.current) return; // hard guard against a double submit
    generatingRef.current = true;
    setState((s) => nextGenerateState(s, { type: "submit" }));
    setErrorText(null);
    setErrorCode(null);
    setErrorDetail(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body("generate"))
      });
      const data = (await res.json()) as GenerateResponse;
      if (data.status === "OK") {
        setResult({ artifact: data.artifact, imageDataUrl: data.imageDataUrl });
        setState((s) => nextGenerateState(s, { type: "generate_ok" }));
      } else {
        const code = data.issues?.[0]?.code ?? null;
        setErrorCode(code);
        setErrorText(generationErrorMessage(code, data.message));
        setErrorDetail(data.issues?.[0]?.message ?? data.message);
        setState((s) => nextGenerateState(s, { type: "generate_error" }));
      }
    } catch {
      setErrorText(generationErrorMessage(null, "The generation request could not be sent."));
      setState((s) => nextGenerateState(s, { type: "generate_error" }));
    } finally {
      generatingRef.current = false;
    }
  }, [body]);

  const aside =
    state === "success" ? (
      <Badge tone="ok" variant="soft" dot>
        Generated
      </Badge>
    ) : state === "error" ? (
      <Badge tone="attention" variant="soft" dot>
        Not generated
      </Badge>
    ) : (
      <Badge tone="neutral" variant="outline">
        Ready to generate
      </Badge>
    );

  return (
    <section className={`container ${styles.section}`} aria-labelledby="generate-heading">
      <StageHeader
        kicker="Stage 7 · generate the visual"
        title="Generate"
        id="generate-heading"
        sub="An execution step. The design is already decided — this hands the compiled prompt to the image provider. You decide whether to run it, and whether to run it again."
        aside={aside}
      />

      {/* context strips — always visible, read straight from the artifacts */}
      <div className={styles.context}>
        {blueprint ? (
          <button type="button" className={styles.contextItem} onClick={() => onNavigate("layout")}>
            <span className={styles.contextLabel}>Layout confirmed</span>
            <span className={styles.contextValue}>{layoutContextLabel(blueprint)}</span>
            <span className={styles.contextLink}>View layout →</span>
          </button>
        ) : null}
        {preview ? (
          <button type="button" className={styles.contextItem} onClick={() => onNavigate("prompt")}>
            <span className={styles.contextLabel}>Prompt ready</span>
            <span className={styles.contextValue}>{promptContextLabel(preview.request, preview.estimate)}</span>
            <span className={styles.contextLink}>Open prompt →</span>
          </button>
        ) : null}
      </div>

      {/* -------- previewing -------- */}
      {state === "previewing" ? (
        <p className={styles.status} role="status" aria-live="polite">
          Preparing the generation request…
        </p>
      ) : null}

      {/* -------- ready / generating: the preview + the button -------- */}
      {(state === "ready" || state === "generating") && preview ? (
        <>
          <h3 className={styles.blockHeading}>What will be generated</h3>
          <dl className={styles.rows}>
            {previewRows(preview.request, preview.estimate).map((row) => (
              <div key={row.label} className={styles.row}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>

          <div className={styles.cost}>
            <span className={styles.costLabel}>Estimated generation cost</span>
            <span className={styles.costValue}>{formatEstimatedCost(preview.estimate)}</span>
            <span className={styles.costNote}>An estimate for budgeting, not an invoice.</span>
          </div>

          {state === "generating" ? (
            <p className={styles.status} role="status" aria-live="polite">
              Generating visual… waiting for the provider response. This usually takes a few
              seconds.
            </p>
          ) : null}

          <div className={styles.actions}>
            <Button
              onClick={() => void generate()}
              loading={state === "generating"}
              disabled={state === "generating"}
              trailing="→"
            >
              {state === "generating" ? "Generating…" : "Generate visual"}
            </Button>
            <Button variant="secondary" onClick={() => onNavigate("prompt")} disabled={state === "generating"}>
              Back to prompt
            </Button>
          </div>
        </>
      ) : null}

      {/* -------- success -------- */}
      {state === "success" && result ? (
        <div className={styles.result}>
          <h3 id="generate-result-heading" ref={resultHeadingRef} tabIndex={-1} className={styles.blockHeading}>
            Generation complete
          </h3>
          <div className={styles.resultGrid}>
            <div className={styles.imageCol}>
              {result.imageDataUrl ? (
                <img
                  className={styles.image}
                  src={result.imageDataUrl}
                  alt={`Generated ${result.artifact.image.width} by ${result.artifact.image.height} visual`}
                  width={result.artifact.image.width}
                  height={result.artifact.image.height}
                />
              ) : (
                <div className={styles.imageWithheld}>
                  <p>The provider returned metadata only for this response.</p>
                  <p className={styles.imageWithheldNote}>
                    Image bytes are not transported in this build. The artifact below records the
                    full generation.
                  </p>
                </div>
              )}
            </div>
            <div className={styles.detailCol}>
              <dl className={styles.rows}>
                {artifactRows(result.artifact).map((row) => (
                  <div key={row.label} className={styles.row}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>

              <div className={styles.provenance}>
                <p className={styles.provenanceHead}>
                  <span className={styles.provenanceKicker}>Based on</span> Recipe · Layout · Prompt
                </p>
                <Disclosure title="Full provenance">
                  <dl className={styles.rows}>
                    {provenanceRows(result.artifact).map((row) => (
                      <div key={row.label} className={styles.row}>
                        <dt>{row.label}</dt>
                        <dd className={styles.mono}>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </Disclosure>
              </div>

              <div className={styles.actions}>
                <Button onClick={() => onNavigate("review")} trailing="→">
                  Continue to review
                </Button>
                <Button variant="secondary" onClick={() => void generate()}>
                  Regenerate
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* -------- error -------- */}
      {state === "error" ? (
        <div className={styles.errorBox} role="alert">
          <h3 ref={resultHeadingRef} tabIndex={-1} className={styles.errorHeading}>
            {preview ? "Generation could not be completed" : "The generation preview failed"}
          </h3>
          <p className={styles.errorMessage}>{errorText}</p>
          {errorDetail && errorDetail !== errorText ? (
            <Disclosure title="Technical details">
              <p className={styles.mono}>
                {errorCode ? `${errorCode}: ` : ""}
                {errorDetail}
              </p>
            </Disclosure>
          ) : null}
          <div className={styles.actions}>
            {preview ? (
              <Button onClick={() => void generate()} trailing="→">
                Try again
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => onNavigate("prompt")}>
              Back to prompt
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
