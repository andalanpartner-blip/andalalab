import styles from "./PlaceholderStage.module.css";
import { StageHeader } from "../ui/StageHeader";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import type { StageId } from "../../lib/workspace";

/** An honest placeholder — no final image is pretended to exist. */
export function FinalStage({
  aspectRatio,
  onNavigate
}: {
  aspectRatio: string;
  onNavigate: (stage: StageId) => void;
}) {
  return (
    <section className={`container ${styles.section}`} aria-labelledby="final-heading">
      <StageHeader
        kicker="Stage 9 · Final"
        title="Final"
        id="final-heading"
        aside={<Badge tone="neutral" variant="outline">Ships with P8</Badge>}
      />

      <p className={styles.lede}>
        The finished visual and the full decision trail — every choice from brief to render, with
        its provenance — will be assembled here for hand-off.
      </p>

      <div className={styles.frame} data-ratio={aspectRatio} aria-hidden="true">
        <span className={styles.frameLabel}>Final visual · {aspectRatio}</span>
      </div>

      <p className={styles.note}>
        There is no final image yet — it arrives once Generate (P8) can produce one and Review has
        signed off on it.
      </p>

      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => onNavigate("review")}>
          Back to Review
        </Button>
      </div>
    </section>
  );
}
