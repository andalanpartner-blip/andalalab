"use client";

import { useCallback, useState } from "react";
import styles from "./page.module.css";
import { Header } from "../components/Header";
import { BriefStage } from "../components/BriefStage";
import { ProcessRail, type ProcessStage } from "../components/ProcessRail";
import { ClarificationStage } from "../components/ClarificationStage";
import { ErrorBanner } from "../components/ErrorBanner";
import { BriefIntelligence } from "../components/BriefIntelligence";
import { DesignDirectionPanel } from "../components/DesignDirectionPanel";
import { ConceptBoard } from "../components/ConceptBoard";
import { SelectedConcept } from "../components/SelectedConcept";
import { RecipeBoard } from "../components/RecipeBoard";
import { DesignReview } from "../components/DesignReview";
import { VisualReview } from "../components/VisualReview";
import { CorrectionPanel } from "../components/CorrectionPanel";
import { PromptSection } from "../components/PromptSection";
import type { ClarificationQuestion, DesignCriticReport, VisualReviewReport } from "../engine";
import type { BriefPipelineResult, BriefReadyResult, RecipePipelineResult } from "../services/pipeline.service";
import type { DesignRecipe } from "../types/schemas/recipe.schema";
import type { DesignContract } from "../types/schemas/contract.schema";
import type { DesignDirection } from "../types/schemas/direction.schema";

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
  /** Contract / direction the current recipe was built from — corrections may replace these. */
  const [recipeContract, setRecipeContract] = useState<DesignContract | null>(null);
  const [recipeDirection, setRecipeDirection] = useState<DesignDirection | null>(null);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [recipeError, setRecipeError] = useState<string | null>(null);

  const submitBrief = useCallback(async (input: PendingRequest) => {
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
      setRecipeContract(null);
      setRecipeDirection(null);
      setRecipeError(null);
      setClarify(null);
      setPhase("ready");
    } else if (data.status === "NEEDS_CLARIFICATION") {
      setClarify({ rawBrief: data.rawBrief, questions: data.questions });
      setPhase("clarify");
    } else {
      // INVALID/ERROR always lands back on an editable brief — with whatever
      // was actually sent (original text, or original + clarification answers)
      // preserved — rather than leaving the user stuck in a dead-end form.
      setErrorMessage(data.message);
      setClarify(null);
      setPhase("input");
      setBriefDraft(data.rawBrief ?? input.rawBrief);
    }

    setBriefBusy(false);
  }, []);

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
    setRecipeContract(null);
    setRecipeDirection(null);
    setRecipeError(null);
  }, []);

  const handleSelectConcept = useCallback(
    (id: string) => {
      setSelectedConceptId((current) => {
        if (current === id) return current;
        setRecipe(null);
        setCritic(null);
        setReview(null);
        setRecipeContract(null);
        setRecipeDirection(null);
        setRecipeError(null);
        return id;
      });
    },
    []
  );

  const handleBuildRecipe = useCallback(async () => {
    if (!result || !selectedConceptId) return;
    const concept = result.concepts.concepts.find((entry) => entry.id === selectedConceptId);
    if (!concept) return;

    setRecipeLoading(true);
    setRecipeError(null);

    const data = await postRecipe({
      contract: result.contract,
      direction: result.direction,
      concept
    });

    if (data.status === "OK") {
      setRecipe(data.recipe);
      setCritic(data.critic);
      setReview(data.review);
      setRecipeContract(result.contract);
      setRecipeDirection(result.direction);
    } else {
      setRecipeError(data.message);
    }
    setRecipeLoading(false);
  }, [result, selectedConceptId]);

  const hasStarted = phase !== "input" || lastRequest !== null;

  const stages: ProcessStage[] = [
    {
      key: "brief",
      label: "Brief",
      status: phase === "ready" ? "done" : briefBusy ? "active" : "pending"
    },
    { key: "strategy", label: "Strategy", status: phase === "ready" ? "done" : "pending" },
    { key: "concept", label: "Concept", status: phase === "ready" ? "done" : "pending" },
    {
      key: "recipe",
      label: "Recipe",
      status: recipe ? "done" : recipeLoading ? "active" : "pending"
    }
  ];

  const selectedConcept = result?.concepts.concepts.find((entry) => entry.id === selectedConceptId) ?? null;

  return (
    <main className={styles.main}>
      <Header />

      {hasStarted ? <ProcessRail stages={stages} /> : null}

      {phase === "ready" ? (
        <div className={`container ${styles.toolbar}`}>
          <div className={styles.toolbarInner}>
            <button type="button" className={styles.newBrief} onClick={handleStartOver}>
              Start a new brief
            </button>
          </div>
        </div>
      ) : null}

      {phase === "input" ? (
        <>
          {errorMessage ? <ErrorBanner message={errorMessage} onRetry={handleRetry} /> : null}
          <BriefStage value={briefDraft} onChange={setBriefDraft} onSubmit={handleAnalyze} submitting={briefBusy} />
        </>
      ) : null}

      {phase === "clarify" && clarify ? (
        <>
          {errorMessage ? <ErrorBanner message={errorMessage} onRetry={handleRetry} /> : null}
          <ClarificationStage
            questions={clarify.questions}
            submitting={briefBusy}
            onContinue={handleClarifyContinue}
            onStartOver={handleStartOver}
          />
        </>
      ) : null}

      {phase === "ready" && result ? (
        <>
          <BriefIntelligence
            brief={result.brief}
            contract={result.contract}
            derived={result.derived}
            countries={result.countries}
          />
          <DesignDirectionPanel summary={result.directionSummary} />
          <ConceptBoard
            concepts={result.concepts.concepts}
            selectedId={selectedConceptId ?? result.concepts.selected.id}
            onSelect={handleSelectConcept}
          />
          {selectedConcept ? (
            <SelectedConcept
              concept={selectedConcept}
              onBuildRecipe={() => void handleBuildRecipe()}
              buildingRecipe={recipeLoading}
              hasRecipe={recipe !== null}
            />
          ) : null}
          {recipeError ? (
            <div className={styles.recipeError}>
              <ErrorBanner message={recipeError} onRetry={() => void handleBuildRecipe()} />
            </div>
          ) : null}
          {recipe && critic ? <DesignReview report={critic} /> : null}
          {recipe && review ? <VisualReview report={review} /> : null}
          {recipe ? <RecipeBoard recipe={recipe} /> : null}
          {recipe && recipeContract && recipeDirection ? (
            <CorrectionPanel
              recipe={recipe}
              contract={recipeContract}
              direction={recipeDirection}
              concept={selectedConcept}
              onCorrected={(next) => {
                setRecipe(next.recipe);
                setCritic(next.critic);
                // the correction pipeline re-runs the P4.0 critic but not the
                // P4.1 review; any rendered-image evidence is now stale.
                setReview(null);
                setRecipeContract(next.contract);
                setRecipeDirection(next.direction);
              }}
            />
          ) : null}
          {recipe ? <PromptSection recipe={recipe} concept={selectedConcept} /> : null}
          <div className={styles.footerSpace} />
        </>
      ) : null}
    </main>
  );
}
