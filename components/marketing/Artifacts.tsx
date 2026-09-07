import styles from "./marketing.module.css";

/**
 * Marketing visual artifacts — built entirely from HTML + CSS + inline SVG.
 *
 * No stock photography, no fabricated product shots, no invented metrics.
 * Each artifact is an abstract, art-directed object that reinforces one idea
 * in the creative workflow. Colour lives inside the artifacts; the page shell
 * stays paper + ink.
 */

export type WorkflowKind = "brief" | "concept" | "recipe" | "generate" | "review" | "final";

const TINT: Record<WorkflowKind, string> = {
  brief: "var(--m-blue)",
  concept: "var(--m-sand)",
  recipe: "var(--m-lilac)",
  generate: "var(--m-green)",
  review: "var(--m-pink)",
  final: "var(--m-green)"
};

/** A single workflow card with its abstract object. Used in the hero sequence. */
export function WorkflowArtifact({
  kind,
  index,
  label
}: {
  kind: WorkflowKind;
  index: string;
  label: string;
}) {
  return (
    <article className={styles.wfCard} style={{ ["--tint" as string]: TINT[kind] }}>
      <header className={styles.wfHead}>
        <span className={styles.wfIndex}>{index}</span>
        <span className={styles.wfLabel}>{label}</span>
      </header>
      <div className={styles.wfObject}>
        <ArtObject kind={kind} />
      </div>
      <footer className={styles.wfFoot}>
        {kind === "brief" && <BriefLines />}
        {kind === "concept" && <ConceptTags />}
        {kind === "recipe" && <RecipeSwatches />}
        {kind === "generate" && <GenMeta />}
        {kind === "review" && <ReviewChecks />}
        {kind === "final" && <ApprovedStamp />}
      </footer>
    </article>
  );
}

/** The abstract object per stage — a distinct silhouette so the sequence reads. */
export function ArtObject({ kind }: { kind: WorkflowKind }) {
  const common = { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 120 120", "aria-hidden": true } as const;
  switch (kind) {
    case "brief":
      return (
        <svg {...common}>
          <rect x="26" y="18" width="68" height="84" rx="6" className={styles.artFill} />
          <path d="M38 40h44M38 54h44M38 68h30" className={styles.artStroke} />
        </svg>
      );
    case "concept":
      return (
        <svg {...common}>
          <circle cx="60" cy="62" r="34" className={styles.artFill} />
          <path d="M60 28a34 34 0 0 1 0 68" className={styles.artStroke2} />
          <circle cx="60" cy="62" r="12" className={styles.artStrokeSolid} />
        </svg>
      );
    case "recipe":
      return (
        <svg {...common}>
          <path d="M28 44 60 22l32 22v40L60 106 28 84Z" className={styles.artFill} />
          <path d="M60 22v84M28 44l64 40M92 44 28 84" className={styles.artStroke} />
        </svg>
      );
    case "generate":
      return (
        <svg {...common}>
          <rect x="24" y="24" width="72" height="72" rx="10" className={styles.artFill} />
          <path d="M40 82c8-30 14-40 20-40s12 10 20 40" className={styles.artStrokeSolid} fill="none" />
          <circle cx="60" cy="40" r="6" className={styles.artDot} />
        </svg>
      );
    case "review":
      return (
        <svg {...common}>
          <rect x="24" y="30" width="72" height="60" rx="8" className={styles.artFill} />
          <path d="M36 60l12 12 24-30" className={styles.artStrokeSolid} fill="none" strokeWidth="6" />
        </svg>
      );
    case "final":
      return (
        <svg {...common}>
          <circle cx="60" cy="60" r="36" className={styles.artFill} />
          <path d="M44 60l11 11 24-27" className={styles.artStrokeSolid} fill="none" strokeWidth="7" />
        </svg>
      );
  }
}

// --- small fragments inside cards ------------------------------------------

function BriefLines() {
  return (
    <div className={styles.frag}>
      <span className={styles.fragBar} style={{ width: "84%" }} />
      <span className={styles.fragBar} style={{ width: "62%" }} />
      <span className={styles.fragBar} style={{ width: "70%" }} />
    </div>
  );
}
function ConceptTags() {
  return (
    <div className={styles.tagRow}>
      {["Modern", "Fresh", "Confident"].map((t) => (
        <span key={t} className={styles.tag}>
          {t}
        </span>
      ))}
    </div>
  );
}
function RecipeSwatches() {
  return (
    <div className={styles.swatchRow}>
      <span style={{ background: "var(--ink)" }} />
      <span style={{ background: "var(--m-green)" }} />
      <span style={{ background: "var(--m-sand)" }} />
      <span style={{ background: "var(--paper)" }} />
    </div>
  );
}
function GenMeta() {
  return (
    <div className={styles.metaRow}>
      <span>1080 × 1350</span>
      <span>4:5</span>
    </div>
  );
}
function ReviewChecks() {
  return (
    <ul className={styles.checkList}>
      <li>
        <Dot tone="ok" /> Focal dominance
      </li>
      <li>
        <Dot tone="ok" /> Colour harmony
      </li>
      <li>
        <Dot tone="attention" /> Type contrast
      </li>
    </ul>
  );
}
function ApprovedStamp() {
  return (
    <span className={styles.stamp}>
      <Dot tone="ok" /> Approved
    </span>
  );
}

export function Dot({ tone }: { tone: "ok" | "attention" | "critical" | "ink" }) {
  const color =
    tone === "ok"
      ? "var(--ok)"
      : tone === "attention"
        ? "var(--attention)"
        : tone === "critical"
          ? "var(--critical)"
          : "var(--ink)";
  return <span className={styles.dot} style={{ background: color }} aria-hidden="true" />;
}

/** A recipe card used in the "visual employee" composition. */
export function RecipeCard() {
  return (
    <div className={styles.panel} data-panel="recipe">
      <p className={styles.panelKicker}>Design Recipe</p>
      <dl className={styles.panelRows}>
        <div>
          <dt>Palette</dt>
          <dd>
            <RecipeSwatches />
          </dd>
        </div>
        <div>
          <dt>Typography</dt>
          <dd>Editorial contrast</dd>
        </div>
        <div>
          <dt>Layout</dt>
          <dd>Image + text split</dd>
        </div>
        <div>
          <dt>Hierarchy</dt>
          <dd>Bold · 82%</dd>
        </div>
      </dl>
    </div>
  );
}

/** A layout blueprint fragment. */
export function BlueprintFrame() {
  return (
    <div className={styles.panel} data-panel="blueprint">
      <p className={styles.panelKicker}>Layout Blueprint</p>
      <div className={styles.bpGrid} aria-hidden="true">
        <span className={styles.bpZone} style={{ gridArea: "1 / 1 / 3 / 4" }} data-role="image" />
        <span className={styles.bpZone} style={{ gridArea: "3 / 1 / 4 / 3" }} data-role="head" />
        <span className={styles.bpZone} style={{ gridArea: "4 / 1 / 5 / 4" }} data-role="body" />
      </div>
      <p className={styles.panelNote}>6 zones · focal on image</p>
    </div>
  );
}

/** A compiled prompt fragment. */
export function PromptCard() {
  return (
    <div className={styles.panel} data-panel="prompt">
      <p className={styles.panelKicker}>Compiled Prompt</p>
      <p className={styles.promptText}>
        Editorial product still life, controlled daylight, generous negative space, restrained
        four-colour palette, no rendered text …
      </p>
      <p className={styles.panelNote}>image-only tier · English</p>
    </div>
  );
}

/** The AI review panel. */
export function ReviewPanel({ compact = false }: { compact?: boolean }) {
  return (
    <div className={styles.panel} data-panel="review" data-compact={compact || undefined}>
      <div className={styles.reviewHead}>
        <p className={styles.panelKicker}>AI Review</p>
        <span className={styles.reviewVerdict}>Review</span>
      </div>
      <ul className={styles.checkList}>
        <li>
          <Dot tone="ok" /> Focal alignment
        </li>
        <li>
          <Dot tone="ok" /> Composition vs intent
        </li>
        <li>
          <Dot tone="attention" /> Whitespace 0.28 vs 0.48
        </li>
        <li>
          <Dot tone="ok" /> Colour relationship
        </li>
      </ul>
      <p className={styles.panelNote}>observed, then compared to the recipe — never scored from pixels alone</p>
    </div>
  );
}

/** The human decision card — the control point. */
export function DecisionCard() {
  return (
    <div className={styles.panel} data-panel="decision">
      <p className={styles.panelKicker}>Human Decision</p>
      <p className={styles.decisionLine}>You decide what happens to this exact visual.</p>
      <div className={styles.decisionRow}>
        <span className={styles.decisionPill} data-active>
          Approve
        </span>
        <span className={styles.decisionPill}>Correct</span>
        <span className={styles.decisionPill}>Regenerate</span>
      </div>
    </div>
  );
}

/** A concept frame. */
export function ConceptFrame() {
  return (
    <div className={styles.panel} data-panel="concept">
      <p className={styles.panelKicker}>Creative Concept</p>
      <p className={styles.conceptName}>The Kinetic Pour</p>
      <p className={styles.panelNote}>Unexpected juxtaposition · movement metaphor</p>
    </div>
  );
}
