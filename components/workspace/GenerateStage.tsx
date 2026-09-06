import styles from "./PlaceholderStage.module.css";
import { StageHeader } from "../ui/StageHeader";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import type { StageId } from "../../lib/workspace";

/** An honest placeholder. No image API, no fake action, no fabricated progress. */
export function GenerateStage({
  aspectRatio,
  onNavigate
}: {
  aspectRatio: string;
  onNavigate: (stage: StageId) => void;
}) {
  return (
    <section className={`container ${styles.section}`} aria-labelledby="generate-heading">
      <StageHeader
        kicker="Stage 6 · Generate"
        title="Generate"
        id="generate-heading"
        aside={<Badge tone="neutral" variant="outline">Ships with P8</Badge>}
      />

      <p className={styles.lede}>
        The prompt is ready to use <strong>today</strong> — copy the master prompt from the Prompt
        stage into your image generator of choice. The render then comes back here for Review.
      </p>

      <div className={styles.frame} data-ratio={aspectRatio} aria-hidden="true">
        <span className={styles.frameLabel}>{aspectRatio}</span>
      </div>

      <p className={styles.note}>
        When the Generation Adapter (P8) ships, generation runs from this stage — a provider behind
        a port, no design decisions, the result flowing straight into Review. Nothing is generated
        here yet.
      </p>

      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => onNavigate("prompt")}>
          Back to the prompt
        </Button>
      </div>
    </section>
  );
}
