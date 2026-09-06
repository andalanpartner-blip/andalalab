"use client";

import type {
  VisualReviewReport,
  ReviewIssue,
  ReviewDimension,
  DesignCriticReport,
  CriticFinding
} from "../engine";
import type { StageId } from "../lib/workspace";
import styles from "./ReviewSummary.module.css";
import { titleCase } from "../lib/format";
import { StageHeader } from "./ui/StageHeader";
import { Panel } from "./ui/Panel";
import { Button } from "./ui/Button";
import { Badge, type BadgeTone } from "./ui/Badge";

const DIMENSION_LABEL: Record<ReviewDimension, string> = {
  design_compliance: "Design compliance",
  visual_quality: "Visual quality",
  technical_quality: "Technical quality"
};

const SEVERITY_LABEL: Record<ReviewIssue["severity"], string> = {
  P0: "Critical",
  P1: "Major",
  P2: "Moderate",
  P3: "Minor"
};

const SEVERITY_TONE: Record<ReviewIssue["severity"], BadgeTone> = {
  P0: "critical",
  P1: "attention",
  P2: "neutral",
  P3: "neutral"
};

const BASIS_LABEL: Record<ReviewIssue["basis"], string> = {
  "evidence-backed": "Evidence-backed",
  "fixture-backed": "Fixture-backed",
  unassessed: "Not assessed"
};

type Verdict = "PASS" | "REVIEW" | "BLOCK" | "UNASSESSED";

const VERDICT_TONE: Record<Verdict, BadgeTone> = {
  PASS: "ok",
  REVIEW: "attention",
  BLOCK: "critical",
  UNASSESSED: "neutral"
};

const AREA_LABEL: Partial<Record<CriticFinding["area"], string>> = {
  dkv: "DKV",
  "prompt-coverage": "Prompt coverage",
  "stereotype-guard": "Stereotype guard"
};

function pctOrDash(score: number | null): string {
  return score === null ? "—" : `${Math.round(score * 100)}%`;
}

function nextActionFor(verdict: Verdict, fullyAssessed: boolean) {
  if (verdict === "BLOCK") {
    return {
      line: "A doctrine-level conflict makes this direction unsuitable — a bounded correction cannot resolve it.",
      primary: { label: "Return to Concept", stage: "concept" as StageId },
      secondary: { label: "Adjust the strategy", stage: "strategy" as StageId }
    };
  }
  if (verdict === "REVIEW") {
    return {
      line: "One or more issues need a human glance. You can proceed, or nudge the recipe.",
      primary: { label: "Apply a correction", stage: "correct" as StageId },
      secondary: { label: "See the prompt anyway", stage: "prompt" as StageId }
    };
  }
  return {
    line: fullyAssessed
      ? "Nothing to review. The design is clear to generate."
      : "Compliance is clear. Visual and technical quality stay unassessed until a rendered frame is reviewed.",
    primary: { label: "Continue to Prompt", stage: "prompt" as StageId },
    secondary: null as { label: string; stage: StageId } | null
  };
}

export type ReviewSummaryProps = {
  /** The P4.1 report. Null after a P6 correction, which re-runs P4.0 only. */
  readonly report: VisualReviewReport | null;
  /** The P4.0 report — always current, including post-correction. */
  readonly critic: DesignCriticReport;
  readonly onNavigate: (stage: StageId) => void;
};

/**
 * The single Review surface. Driven by the P4.1 `VisualReviewReport` when it
 * exists (it embeds the P4.0 report, so compliance findings appear once). After
 * a correction only the fresh P4.0 `critic` is available — the surface then
 * shows compliance from it and marks the two renderable dimensions "not
 * assessed" until the recipe is rebuilt. Neither critic's logic is touched.
 */
export function ReviewSummary({ report, critic, onNavigate }: ReviewSummaryProps) {
  const verdict: Verdict = report ? report.overall.verdict : critic.verdict;
  const fullyAssessed = report?.overall.status === "assessed";
  const action = nextActionFor(verdict, Boolean(fullyAssessed));

  const dimensions = report
    ? report.dimensions
    : ([
        {
          dimension: "design_compliance" as const,
          status: "assessed" as const,
          basis: "evidence-backed" as const,
          score: null,
          issue_count: critic.findings.length
        },
        {
          dimension: "visual_quality" as const,
          status: "unassessed" as const,
          basis: "unassessed" as const,
          score: null,
          issue_count: 0
        },
        {
          dimension: "technical_quality" as const,
          status: "unassessed" as const,
          basis: "unassessed" as const,
          score: null,
          issue_count: 0
        }
      ] satisfies VisualReviewReport["dimensions"]);

  const summary = report
    ? report.summary
    : `${verdict === "PASS" ? "Compliance clear" : verdict === "REVIEW" ? "Compliance needs a look" : "Compliance blocked"} — reviewed against the corrected recipe. Rebuild for a full visual review.`;

  const byDimension = (dimension: ReviewDimension): ReviewIssue[] =>
    report ? report.issues.filter((issue) => issue.dimension === dimension) : [];

  const actionableCount = report
    ? report.issues.filter((i) => i.basis !== "unassessed").length
    : critic.findings.length;

  return (
    <section className={`container ${styles.section}`} aria-labelledby="review-heading">
      <StageHeader
        kicker="Pre-generation review — deterministic, evidence-gated"
        title="Review"
        id="review-heading"
        sub="Design compliance is checked from the pipeline. Visual and technical quality can only be judged from a rendered frame — until one exists they are reported as not assessed, never guessed."
      />

      <div className={`${styles.verdict} ${styles[`verdict_${verdict}`]}`}>
        <div className={styles.verdictHead} key={verdict}>
          <span className="crossfade">
            <Badge tone={VERDICT_TONE[verdict]} variant="soft">
              {titleCase(verdict)}
            </Badge>
          </span>
          <span className={styles.summary}>{summary}</span>
        </div>
        <p className={styles.nextLine}>{action.line}</p>
        <div className={styles.nextActions}>
          <Button
            size="sm"
            variant={verdict === "PASS" ? "primary" : "secondary"}
            onClick={() => onNavigate(action.primary.stage)}
            trailing={verdict === "PASS" ? "→" : undefined}
          >
            {action.primary.label}
          </Button>
          {action.secondary ? (
            <Button size="sm" variant="ghost" onClick={() => onNavigate(action.secondary!.stage)}>
              {action.secondary.label}
            </Button>
          ) : null}
        </div>
      </div>

      <div className={styles.dimensions}>
        {dimensions.map((d) => (
          <Panel key={d.dimension} className={styles.dimension}>
            <p className={styles.dimensionName}>{DIMENSION_LABEL[d.dimension]}</p>
            <span
              className={`${styles.dimensionScore} ${d.status === "unassessed" ? styles.unassessed : ""}`}
            >
              {d.status === "unassessed" ? "Not assessed" : pctOrDash(d.score)}
            </span>
            <p className={styles.dimensionMeta}>
              {d.status === "assessed"
                ? `${BASIS_LABEL[d.basis]} · ${d.issue_count} issue${d.issue_count === 1 ? "" : "s"}`
                : "Awaiting a rendered frame (P8)"}
            </p>
          </Panel>
        ))}
      </div>

      {/* P4.1 issue groups (full report) */}
      {report
        ? (["design_compliance", "visual_quality", "technical_quality"] as ReviewDimension[]).map(
            (dimension) => {
              const issues = byDimension(dimension);
              if (issues.length === 0) return null;
              return (
                <div key={dimension} className={styles.group}>
                  <p className={styles.groupName}>{DIMENSION_LABEL[dimension]}</p>
                  <ul className={styles.issues}>
                    {issues.map((issue, index) => (
                      <li
                        key={`${issue.category}-${index}`}
                        className={
                          issue.basis === "unassessed"
                            ? styles.issue_unassessed
                            : styles[`issue_${issue.severity}`]
                        }
                      >
                        <div className={styles.issueHead}>
                          {issue.basis === "unassessed" ? (
                            <Badge tone="neutral" variant="outline" className={styles.dashed}>
                              Not assessed
                            </Badge>
                          ) : (
                            <>
                              <Badge tone={SEVERITY_TONE[issue.severity]} variant="soft">
                                {SEVERITY_LABEL[issue.severity]}
                              </Badge>
                              <Badge
                                tone={issue.basis === "fixture-backed" ? "attention" : "neutral"}
                                variant="outline"
                              >
                                {BASIS_LABEL[issue.basis]}
                              </Badge>
                            </>
                          )}
                          <span className={styles.category}>{titleCase(issue.category)}</span>
                        </div>
                        <p className={styles.what}>{issue.what}</p>
                        {issue.basis !== "unassessed" ? (
                          <>
                            <p className={styles.detail}>
                              <b>Why:</b> {issue.why}
                            </p>
                            <p className={styles.detail}>
                              <b>Impact:</b> {issue.impact}
                            </p>
                            <p className={styles.detail}>
                              <b>Fix:</b> {issue.fix}
                            </p>
                            {issue.evidence.length > 0 ? (
                              <p className={styles.evidence}>{issue.evidence.join(" · ")}</p>
                            ) : null}
                          </>
                        ) : (
                          <p className={styles.detail}>{issue.fix}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            }
          )
        : null}

      {/* Compliance-only fallback: the raw P4.0 findings after a correction */}
      {!report && critic.findings.length > 0 ? (
        <div className={styles.group}>
          <p className={styles.groupName}>Design compliance</p>
          <ul className={styles.issues}>
            {critic.findings.map((finding, index) => (
              <li key={`${finding.check}-${index}`} className={styles[`issue_${finding.severity}`]}>
                <div className={styles.issueHead}>
                  <Badge tone={SEVERITY_TONE[finding.severity]} variant="soft">
                    {SEVERITY_LABEL[finding.severity]}
                  </Badge>
                  <span className={styles.category}>
                    {AREA_LABEL[finding.area] ?? titleCase(finding.area)}
                  </span>
                </div>
                <p className={styles.what}>{finding.message}</p>
                {finding.evidence.length > 0 ? (
                  <p className={styles.evidence}>{finding.evidence.join(" · ")}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {actionableCount === 0 ? (
        <p className={styles.clean}>
          {critic.checks_run} deterministic checks ran against the resolved DKV values, the
          immutable anchors, the movement influence, the photographic finish, the stereotype guard
          and the constraint coverage — every one holds.
        </p>
      ) : null}

      {report ? (
        <p className={styles.doctrine}>Doctrine order preserved: {report.doctrine.join(" ")}</p>
      ) : null}
    </section>
  );
}
