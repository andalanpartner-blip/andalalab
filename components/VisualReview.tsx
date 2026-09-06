import type { VisualReviewReport, ReviewIssue, ReviewDimension } from "../engine";
import styles from "./VisualReview.module.css";
import { titleCase } from "../lib/format";
import { StageHeader } from "./ui/StageHeader";
import { Panel } from "./ui/Panel";
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

const BASIS_TONE: Record<ReviewIssue["basis"], BadgeTone> = {
  "evidence-backed": "neutral",
  "fixture-backed": "attention",
  unassessed: "neutral"
};

const VERDICT_TONE: Record<VisualReviewReport["overall"]["verdict"], BadgeTone> = {
  PASS: "ok",
  REVIEW: "attention",
  BLOCK: "critical",
  UNASSESSED: "neutral"
};

function pctOrDash(score: number | null): string {
  return score === null ? "—" : `${Math.round(score * 100)}%`;
}

export function VisualReview({ report }: { report: VisualReviewReport }) {
  const byDimension = (dimension: ReviewDimension): ReviewIssue[] =>
    report.issues.filter((issue) => issue.dimension === dimension);

  return (
    <section className={`container reveal ${styles.section}`} aria-labelledby="visual-review-heading">
      <StageHeader
        kicker="Visual Review — P4.1 · deterministic, evidence-gated"
        title="Visual Review"
        id="visual-review-heading"
        sub={
          <>
            Design compliance is checked deterministically from the pipeline. Visual and technical
            quality can only be judged from a rendered frame — until one is reviewed they are reported
            as <em>not assessed</em>, never guessed.
          </>
        }
      />

      <div className={`${styles.overall} ${styles[`overall_${report.overall.verdict}`]}`}>
        <Badge tone={VERDICT_TONE[report.overall.verdict]} variant="soft">
          {titleCase(report.overall.verdict)}
        </Badge>
        <span className={styles.summary}>{report.summary}</span>
      </div>

      <div className={styles.dimensions}>
        {report.dimensions.map((dimension) => (
          <Panel key={dimension.dimension} className={styles.dimension}>
            <p className={styles.dimensionName}>{DIMENSION_LABEL[dimension.dimension]}</p>
            <span
              className={`${styles.dimensionScore} ${dimension.status === "unassessed" ? styles.unassessed : ""}`}
            >
              {dimension.status === "unassessed" ? "Not assessed" : pctOrDash(dimension.score)}
            </span>
            <p className={styles.dimensionMeta}>
              {dimension.status === "assessed"
                ? `${BASIS_LABEL[dimension.basis]} · ${dimension.issue_count} issue${dimension.issue_count === 1 ? "" : "s"}`
                : "No rendered-image evidence"}
            </p>
          </Panel>
        ))}
      </div>

      {(["design_compliance", "visual_quality", "technical_quality"] as ReviewDimension[]).map((dimension) => {
        const issues = byDimension(dimension);
        if (issues.length === 0) return null;
        return (
          <div key={dimension} className={styles.group}>
            <p className={styles.groupName}>{DIMENSION_LABEL[dimension]}</p>
            <ul className={styles.issues}>
              {issues.map((issue, index) => (
                <li key={`${issue.category}-${index}`} className={styles[`issue_${issue.severity}`]}>
                  <div className={styles.issueHead}>
                    <Badge tone={SEVERITY_TONE[issue.severity]} variant="soft">
                      {SEVERITY_LABEL[issue.severity]}
                    </Badge>
                    <span className={styles.category}>{titleCase(issue.category)}</span>
                    <Badge
                      tone={BASIS_TONE[issue.basis]}
                      variant="outline"
                      className={issue.basis === "unassessed" ? styles.basisDashed : undefined}
                    >
                      {BASIS_LABEL[issue.basis]}
                    </Badge>
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
      })}

      <p className={styles.doctrine}>Doctrine order preserved: {report.doctrine.join(" ")}</p>
    </section>
  );
}
