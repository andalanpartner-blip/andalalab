"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import { Header } from "../components/Header";
import { BriefStage } from "../components/BriefStage";
import { ClarificationStage } from "../components/ClarificationStage";
import { ErrorBanner } from "../components/ErrorBanner";
import { BriefIntelligence } from "../components/BriefIntelligence";
import { DesignDirectionPanel } from "../components/DesignDirectionPanel";
import { ConceptCompare } from "../components/ConceptCompare";
import { ConceptStrip } from "../components/ConceptStrip";
import { RecipeStageSummary } from "../components/RecipeStageSummary";
import { DecisionLedger } from "../components/DecisionLedger";
import { ComplianceChip } from "../components/ComplianceChip";
import { CorrectionPanel } from "../components/CorrectionPanel";
import { PromptOutput } from "../components/PromptOutput";
import { LayoutBlueprint, LayoutBackLink } from "../components/LayoutBlueprint";
import { GenerateStage } from "../components/workspace/GenerateStage";
import { ReviewStage } from "../components/workspace/ReviewStage";
import { FinalStage } from "../components/workspace/FinalStage";
import { WorkspaceShell } from "../components/workspace/WorkspaceShell";
import { AIStatus, type AIStatusStep } from "../components/workspace/AIStatus";
import { StageHeader } from "../components/ui/StageHeader";
import { Panel } from "../components/ui/Panel";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import type {
  ClarificationQuestion,
  DesignCriticReport,
  VisualReviewReport,
  LayoutBlueprint as LayoutBlueprintArtifact
} from "../engine";
import type { BriefPipelineResult, BriefReadyResult, RecipePipelineResult } from "../services/pipeline.service";
import type { DesignRecipe } from "../types/schemas/recipe.schema";
import type { DesignContract } from "../types/schemas/contract.schema";
import type { DesignDirection } from "../types/schemas/direction.schema";
import type {
  GeneratedArtifact,
  GenerationRequest
} from "../types/schemas/visual-generation.schema";
import {
  deriveStageStates,
  defaultStage,
  isReachable,
  isStageId,
  type StageId,
  type StageState
} from "../lib/workspace";

type Phase = "input" | "clarify" | "ready";

type PendingRequest = { readonly rawBrief: string; readonly answers?: Record<string, string> };

async function postBrief(input: PendingRequest): Promise<BriefPipelineResult> {
  const response = await fetch("/api/brief", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return (await response.json()) as BriefPipelineResult;
}

async function postRecipe(input: {
  contract: unknown;
  direction: unknown;
  concept: unknown;
}): Promise<RecipePipelineResult> {
  const response = await fetch("/api/recipe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return (await response.json()) as RecipePipelineResult;
}

function readStageFromUrl(): StageId | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("stage");
  return isStageId(value) ? value : null;
}

const ASPECT_LABEL: Record<string, string> = {
  portrait: "4:5",
  square: "1:1",
  landscape: "16:9",
  vertical: "9:16",
  wide: "16:9",
  ultrawide: "21:9",
  "a4-portrait": "A4",
  "a4-landscape": "A4",
  "landscape-16-9": "16:9",
  "billboard-3-1": "3:1"
};

/** A genuine loading placeholder for the recipe stage while /api/recipe runs. */
function RecipeSkeleton() {
  return (
    <section className="container" aria-busy="true">
      <StageHeader kicker="Stage 4 · Recipe" title="Design Recipe" />
      <Skeleton variant="line" lines={2} />
      <div style={{ marginTop: "var(--space-5)" }}>
        <Skeleton variant="panel" height="88px" />
      </div>
      <div style={{ marginTop: "var(--space-3)" }}>
        <Skeleton variant="panel" height="88px" />
      </div>
      <div style={{ marginTop: "var(--space-3)" }}>
        <Skeleton variant="panel" height="88px" />
      </div>
    </section>
  );
}

export default function Page() {
  const [briefDraft, setBriefDraft] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [briefBusy, setBriefBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<PendingRequest | null>(null);
  const [clarify, setClarify] = useState<{
    rawBrief: string;
    questions: readonly ClarificationQuestion[];
  } | null>(null);
  const [result, setResult] = useState<BriefReadyResult | null>(null);

  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<DesignRecipe | null>(null);
  const [critic, setCritic] = useState<DesignCriticReport | null>(null);
  const [review, setReview] = useState<VisualReviewReport | null>(null);
  const [blueprint, setBlueprint] = useState<LayoutBlueprintArtifact | null>(null);
  /** Contract / direction the current recipe was built from — corrections may replace these. */
  const [recipeContract, setRecipeContract] = useState<DesignContract | null>(null);
  const [recipeDirection, setRecipeDirection] = useState<DesignDirection | null>(null);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [recipeError, setRecipeError] = useState<string | null>(null);

  /**
   * The generated visual, threaded from the Generate stage into Review. Cleared
   * whenever the design changes (new brief, new concept, rebuilt recipe) — but
   * deliberately KEPT after a correction so Review can show the mismatch.
   */
  const [generatedArtifact, setGeneratedArtifact] = useState<GeneratedArtifact | null>(null);
  const [generatedRequest, setGeneratedRequest] = useState<GenerationRequest | null>(null);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);

  const clearGeneratedVisual = useCallback(() => {
    setGeneratedArtifact(null);
    setGeneratedRequest(null);
    setGeneratedImageUrl(null);
  }, []);

  const [activeStage, setActiveStage] = useState<StageId>("brief");
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [changedPaths, setChangedPaths] = useState<readonly string[]>([]);

  // -- stage state model -------------------------------------------------
  const stageStates = useMemo(
    () =>
      deriveStageStates({
        briefReady: result !== null,
        clarifying: phase === "clarify",
        conceptSelected: selectedConceptId !== null && result !== null,
        hasRecipe: recipe !== null,
        hasReview: review !== null,
        criticVerdict: critic?.verdict ?? null
      }),
    [result, phase, selectedConceptId, recipe, review, critic]
  );

  /** Navigate to a stage (state + URL), if it is reachable. */
  const goToStage = useCallback(
    (id: StageId, opts: { force?: boolean } = {}) => {
      if (!opts.force && !isReachable(stageStates[id])) return;
      setActiveStage(id);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("stage", id);
        window.history.replaceState(null, "", url);
      }
    },
    [stageStates]
  );

  // Sync from URL on mount + on back/forward.
  useEffect(() => {
    const fromUrl = readStageFromUrl();
    if (fromUrl) setActiveStage(fromUrl);
    const onPop = () => {
      const id = readStageFromUrl();
      if (id) setActiveStage(id);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // If the active stage becomes unreachable (upstream change or a stale URL),
  // fall back to the furthest sensible stage and keep the URL honest.
  useEffect(() => {
    if (!isReachable(stageStates[activeStage])) {
      const fallback = defaultStage(stageStates);
      setActiveStage(fallback);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("stage", fallback);
        window.history.replaceState(null, "", url);
      }
    }
  }, [stageStates, activeStage]);

  const submitBrief = useCallback(
    async (input: PendingRequest) => {
      setBriefBusy(true);
      setErrorMessage(null);
      setLastRequest(input);

      const data = await postBrief(input);

      if (data.status === "READY") {
        setResult(data);
        setSelectedConceptId(data.concepts.selected.id);
        setRecipe(null);
        setCritic(null);
        setReview(null);
        setBlueprint(null);
        setRecipeContract(null);
        setRecipeDirection(null);
        setRecipeError(null);
        clearGeneratedVisual();
        setClarify(null);
        setPhase("ready");
        goToStage("strategy", { force: true });
      } else if (data.status === "NEEDS_CLARIFICATION") {
        setClarify({ rawBrief: data.rawBrief, questions: data.questions });
        setPhase("clarify");
      } else {
        setErrorMessage(data.message);
        setClarify(null);
        setPhase("input");
        setBriefDraft(data.rawBrief ?? input.rawBrief);
      }

      setBriefBusy(false);
    },
    [goToStage, clearGeneratedVisual]
  );

  const handleAnalyze = useCallback(() => {
    void submitBrief({ rawBrief: briefDraft });
  }, [briefDraft, submitBrief]);

  const handleClarifyContinue = useCallback(
    (answers: Record<string, string>) => {
      if (!clarify) return;
      void submitBrief({ rawBrief: clarify.rawBrief, answers });
    },
    [clarify, submitBrief]
  );

  const handleRetry = useCallback(() => {
    if (lastRequest) void submitBrief(lastRequest);
  }, [lastRequest, submitBrief]);

  const handleStartOver = useCallback(() => {
    setBriefDraft("");
    setPhase("input");
    setBriefBusy(false);
    setErrorMessage(null);
    setLastRequest(null);
    setClarify(null);
    setResult(null);
    setSelectedConceptId(null);
    setRecipe(null);
    setCritic(null);
    setReview(null);
    setBlueprint(null);
    setRecipeContract(null);
    setRecipeDirection(null);
    setRecipeError(null);
    clearGeneratedVisual();
    goToStage("brief", { force: true });
  }, [goToStage, clearGeneratedVisual]);

  const handleEditBrief = useCallback(() => {
    setPhase("input");
    setBriefDraft(lastRequest?.rawBrief ?? briefDraft);
    goToStage("brief", { force: true });
  }, [lastRequest, briefDraft, goToStage]);

  const handleSelectConcept = useCallback(
    (id: string) => {
      setSelectedConceptId((current) => {
        if (current === id) return current;
        setRecipe(null);
        setCritic(null);
        setReview(null);
        setBlueprint(null);
        setRecipeContract(null);
        setRecipeDirection(null);
        setRecipeError(null);
        clearGeneratedVisual();
        return id;
      });
    },
    [clearGeneratedVisual]
  );

  const handleBuildRecipe = useCallback(async () => {
    if (!result || !selectedConceptId) return;
    const concept = result.concepts.concepts.find((entry) => entry.id === selectedConceptId);
    if (!concept) return;

    setRecipeLoading(true);
    setRecipeError(null);
    // Move to the recipe stage now and show a skeleton while the POST runs —
    // the wait belongs to that stage, not the concept stage.
    goToStage("recipe", { force: true });

    const data = await postRecipe({
      contract: result.contract,
      direction: result.direction,
      concept
    });

    if (data.status === "OK") {
      setRecipe(data.recipe);
      setCritic(data.critic);
      setReview(data.review);
      setBlueprint(data.blueprint);
      setRecipeContract(result.contract);
      setRecipeDirection(result.direction);
      clearGeneratedVisual();
    } else {
      setRecipeError(data.message);
      goToStage("concept", { force: true });
    }
    setRecipeLoading(false);
  }, [result, selectedConceptId, goToStage, clearGeneratedVisual]);

  const selectedConcept =
    result?.concepts.concepts.find((entry) => entry.id === selectedConceptId) ?? null;

  // The real operation running right now — one honest line, no fabricated steps.
  const aiStep: AIStatusStep | null = briefBusy
    ? clarify
      ? "clarifying-brief"
      : "interpreting-brief"
    : recipeLoading
      ? "building-recipe"
      : null;

  const railStates = useMemo<Record<StageId, StageState>>(() => {
    const out = { ...stageStates } as Record<StageId, StageState>;
    if (isReachable(stageStates[activeStage])) out[activeStage] = "active";
    return out;
  }, [stageStates, activeStage]);

  // -- the canvas for the active stage --------------------------------
  const canvas = (() => {
    switch (activeStage) {
      case "brief":
        if (phase === "clarify" && clarify) {
          return (
            <>
              {errorMessage ? <ErrorBanner message={errorMessage} onRetry={handleRetry} /> : null}
              <ClarificationStage
                questions={clarify.questions}
                submitting={briefBusy}
                onContinue={handleClarifyContinue}
                onStartOver={handleStartOver}
              />
            </>
          );
        }
        if (phase === "ready" && result) {
          return (
            <section className={`container ${styles.stageSection}`} aria-labelledby="brief-recap-heading">
              <StageHeader kicker="Stage 1 · Brief" title="Your brief" id="brief-recap-heading" />
              <Panel>
                <p className={styles.recapText}>{lastRequest?.rawBrief ?? briefDraft}</p>
              </Panel>
              <p className={styles.recapHint}>
                The AI read this — see <button type="button" className={styles.linkInline} onClick={() => goToStage("strategy")}>Strategy</button> for what it understood.
              </p>
              <div className={styles.stageActions}>
                <Button variant="secondary" onClick={handleEditBrief}>
                  Edit brief
                </Button>
                <Button variant="link" onClick={handleStartOver}>
                  Start a new brief
                </Button>
              </div>
            </section>
          );
        }
        return (
          <>
            {errorMessage ? <ErrorBanner message={errorMessage} onRetry={handleRetry} /> : null}
            <BriefStage
              value={briefDraft}
              onChange={setBriefDraft}
              onSubmit={handleAnalyze}
              submitting={briefBusy}
            />
          </>
        );

      case "strategy":
        if (!result) return null;
        return (
          <>
            <BriefIntelligence
              brief={result.brief}
              contract={result.contract}
              derived={result.derived}
              countries={result.countries}
            />
            <DesignDirectionPanel summary={result.directionSummary} />
            <div className={styles.stageActions}>
              <Button onClick={() => goToStage("concept")} trailing="→">
                Choose a concept
              </Button>
            </div>
          </>
        );

      case "concept":
        if (!result) return null;
        return (
          <>
            {recipeError ? (
              <div className={styles.recipeError}>
                <ErrorBanner message={recipeError} onRetry={() => void handleBuildRecipe()} />
              </div>
            ) : null}
            <ConceptCompare
              concepts={result.concepts.concepts}
              selectedId={selectedConceptId ?? result.concepts.selected.id}
              onSelect={handleSelectConcept}
              onBuildRecipe={() => void handleBuildRecipe()}
              buildingRecipe={recipeLoading}
              hasRecipe={recipe !== null}
              hasDownstream={recipe !== null || review !== null}
            />
          </>
        );

      case "recipe":
        if (!recipe && recipeLoading) return <RecipeSkeleton />;
        if (!recipe) {
          return (
            <section className={`container ${styles.stageSection}`}>
              <StageHeader kicker="Stage 4 · Recipe" title="Design Recipe" />
              <EmptyState
                title="No recipe yet"
                description="Choose a concept and build the design recipe — every value it produces traces back to the country, movement or industry behind it."
                action={
                  <Button variant="secondary" onClick={() => goToStage("concept")}>
                    Go to Concept
                  </Button>
                }
              />
            </section>
          );
        }
        return (
          <>
            {selectedConcept ? (
              <ConceptStrip concept={selectedConcept} onEdit={() => goToStage("concept")} />
            ) : null}
            {critic ? (
              <div className={styles.stageChip}>
                <ComplianceChip critic={critic} onOpen={() => goToStage("review")} />
              </div>
            ) : null}
            <RecipeStageSummary recipe={recipe} onOpenLedger={() => setLedgerOpen(true)} />
            <div className={styles.stageActions}>
              <Button onClick={() => goToStage("layout")} trailing="→">
                See the layout
              </Button>
              <Button variant="secondary" onClick={() => goToStage("review")}>
                Review the design
              </Button>
            </div>
          </>
        );

      case "layout":
        if (!recipe || !blueprint) return null;
        return (
          <LayoutBlueprint
            blueprint={blueprint}
            recipeHash={recipe.recipe_hash}
            onNavigate={goToStage}
          />
        );

      case "prompt":
        if (!recipe) return null;
        return (
          <>
            {selectedConcept ? (
              <ConceptStrip concept={selectedConcept} onEdit={() => goToStage("concept")} />
            ) : null}
            {critic ? (
              <div className={styles.stageChip}>
                <ComplianceChip critic={critic} onOpen={() => goToStage("review")} />
              </div>
            ) : null}
            {blueprint ? (
              <div className={styles.stageChip}>
                <LayoutBackLink blueprint={blueprint} onOpen={() => goToStage("layout")} />
              </div>
            ) : null}
            <PromptOutput recipe={recipe} concept={selectedConcept} />
            <div className={styles.stageActions}>
              <Button variant="secondary" onClick={() => goToStage("generate")}>
                Generate
              </Button>
              <Button variant="ghost" onClick={() => goToStage("review")}>
                Review the design
              </Button>
            </div>
          </>
        );

      case "generate":
        if (!recipe || !recipeContract) return null;
        return (
          <GenerateStage
            recipe={recipe}
            contract={recipeContract}
            concept={selectedConcept}
            blueprint={blueprint}
            onNavigate={goToStage}
            onGenerated={(artifact, request, imageDataUrl) => {
              setGeneratedArtifact(artifact);
              setGeneratedRequest(request);
              setGeneratedImageUrl(imageDataUrl);
            }}
          />
        );

      case "final":
        if (!recipe) return null;
        return (
          <FinalStage
            aspectRatio={ASPECT_LABEL[recipe.platform.aspect_ratio_id] ?? recipe.platform.aspect_ratio_id}
            onNavigate={goToStage}
          />
        );

      case "review":
        if (!recipe || !critic || !recipeContract) return null;
        return (
          <>
            {selectedConcept ? (
              <ConceptStrip concept={selectedConcept} onEdit={() => goToStage("concept")} />
            ) : null}
            <ReviewStage
              recipe={recipe}
              contract={recipeContract}
              direction={recipeDirection}
              concept={selectedConcept}
              blueprint={blueprint}
              critic={critic}
              review={review}
              artifact={generatedArtifact}
              request={generatedRequest}
              imageDataUrl={generatedImageUrl}
              onNavigate={goToStage}
              onCorrectionApplied={(next) => {
                setRecipe(next.recipe);
                setCritic(next.critic);
                setReview(null);
                setBlueprint(next.blueprint);
                setRecipeContract(next.contract);
                setRecipeDirection(next.direction);
                setChangedPaths(next.changedPaths);
                // the generated visual is deliberately KEPT — the stale banner
                // now prompts a deliberate regeneration.
              }}
            />
          </>
        );

      case "correct":
        if (!recipe || !recipeContract || !recipeDirection) return null;
        return (
          <CorrectionPanel
            recipe={recipe}
            contract={recipeContract}
            direction={recipeDirection}
            concept={selectedConcept}
            onCorrected={(next) => {
              setRecipe(next.recipe);
              setCritic(next.critic);
              setReview(null);
              setBlueprint(next.blueprint);
              setRecipeContract(next.contract);
              setRecipeDirection(next.direction);
              setChangedPaths(next.changedPaths);
            }}
          />
        );

      default:
        return null;
    }
  })();

  return (
    <main className={styles.main}>
      <Header />
      <WorkspaceShell
        states={railStates}
        active={activeStage}
        onNavigate={(id) => goToStage(id)}
        ledger={recipe ? <DecisionLedger recipe={recipe} recentlyChanged={changedPaths} /> : null}
        ledgerAvailable={recipe !== null}
        ledgerOpen={ledgerOpen}
        onLedgerOpenChange={setLedgerOpen}
        aiStatus={<AIStatus step={aiStep} />}
        toolbar={
          phase === "ready" ? (
            <Button variant="link" onClick={handleStartOver}>
              Start a new brief
            </Button>
          ) : null
        }
      >
        <div key={`${activeStage}-${phase}`} className="stage-in">
          {canvas}
        </div>
      </WorkspaceShell>
    </main>
  );
}
