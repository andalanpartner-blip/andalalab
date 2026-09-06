import type { VisualReviewReport, ReviewIssue, ReviewDimension } from "../engine";
import styles from "./VisualReview.module.css";
import { titleCase } from "../lib/format";

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

const BASIS_LABEL: Record<ReviewIssue["basis"], string> = {
  "evidence-backed": "Evidence-backed",
  "fixture-backed": "Fixture-backed",
  unassessed: "Not assessed"
};

const BASIS_CLASS: Record<ReviewIssue["basis"], string> = {
  "evidence-backed": styles.basis_evidence!,
  "fixture-backed": styles.basis_fixture!,
  unassessed: styles.basis_unassessed!
};

function pctOrDash(score: number | null): string {
  return score === null ? "—" : `${Math.round(score * 100)}%`;
}

export function VisualReview({ report }: { report: VisualReviewReport }) {
  const byDimension = (dimension: ReviewDimension): ReviewIssue[] =>
    report.issues.filter((issue) => issue.dimension === dimension);

  return (
    <section className={`container reveal ${styles.section}`} aria-labelledby="visual-review-heading">
      <p className={styles.kicker}>Visual Review — P4.1 · deterministic, evidence-gated</p>
      <h2 id="visual-review-heading" className={styles.title}>
        Visual Review
      </h2>
      <p className={styles.lede}>
        Design compliance is checked deterministically from the pipeline. Visual and technical
        quality can only be judged from a rendered frame — until one is reviewed they are reported
        as <em>not assessed</em>, never guessed.
      </p>

      <div className={`${styles.overall} ${styles[`overall_${report.overall.verdict}`]}`}>
        <span className={styles.badge}>{titleCase(report.overall.verdict)}</span>
        <span className={styles.summary}>{report.summary}</span>
      </div>

      <div className={styles.dimensions}>
        {report.dimensions.map((dimension) => (
          <div key={dimension.dimension} className={styles.dimension}>
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
          </div>
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
                    <span className={styles.severity}>{SEVERITY_LABEL[issue.severity]}</span>
                    <span className={styles.category}>{titleCase(issue.category)}</span>
                    <span className={`${styles.basis} ${BASIS_CLASS[issue.basis]}`}>
                      {BASIS_LABEL[issue.basis]}
                    </span>
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

      <p className={styles.doctrine}>
        Doctrine order preserved: {report.doctrine.join(" ")}
      </p>
    </section>
  );
}
