import styles from "./marketing.module.css";
import { MarketingNav } from "./MarketingNav";
import { HeroStage } from "./HeroStage";
import { LayerStack } from "./LayerStack";
import { Reveal } from "./Reveal";
import {
  BlueprintFrame,
  ConceptFrame,
  DecisionCard,
  Dot,
  RecipeCard,
  ReviewPanel
} from "./Artifacts";

/**
 * The Andala AI Visual Employee marketing experience.
 *
 * A public, editorial, scroll-driven narrative that sits ABOVE the private
 * product: what it is → why it exists → how it thinks → how it works → how it
 * works with designers → the workflow → the output → why a team should use it
 * → CTA. Every CTA points to the existing private login; no public signup.
 *
 * All visuals are HTML + CSS + inline SVG. No stock photography, no fabricated
 * customers / metrics / testimonials. Motion is progressive enhancement and
 * respects `prefers-reduced-motion`.
 */

const WORKFLOW_STAGES = [
  "Brief",
  "Strategy",
  "Concept",
  "Design",
  "Layout",
  "Prompt",
  "Generate",
  "AI Review",
  "Your Decision",
  "Final"
];

const OLD_WAY = ["Brief", "Prompt", "Generate", "Hope"];
const ANDALA_WAY = [
  "Brief",
  "Strategy",
  "Concept",
  "Design decision",
  "Recipe",
  "Layout",
  "Prompt",
  "Generate",
  "Review",
  "Correct",
  "Approve"
];

const AI_SIDE = ["Thinking", "Structuring", "Exploring", "Generating", "Checking"];
const HUMAN_SIDE = ["Taste", "Philosophy", "Originality", "Context", "Creative direction", "Final approval"];

const LOOP = [
  "Generated visual",
  "Visual evidence",
  "AI critique",
  "Correction recommendation",
  "Human decision",
  "Regenerate"
];

const TEAM = [
  { role: "Creative Director", sees: "Creative approval — the final word on every visual." },
  { role: "Designer", sees: "The full production workflow, brief to final." },
  { role: "Account", sees: "Project status and the approved output." },
  { role: "AI Visual Employee", sees: "Intelligence and execution — never the decision." }
];

export function Marketing() {
  return (
    <div className={styles.page} id="top">
      <a href="#problem" className={styles.skip}>
        Skip to content
      </a>
      <MarketingNav />

      <main>
        {/* 01 — HERO ---------------------------------------------------- */}
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Andala AI Visual Employee</p>
            <h1 id="hero-title" className={styles.heroTitle}>
              Your creative partner
              <br />
              from brief to final.
            </h1>
            <p className={styles.heroSub}>
              An AI visual employee that understands design, works with your team, and helps turn
              ideas into production-ready creative work.
            </p>
            <div className={styles.heroActions}>
              <a className={styles.btnPrimary} href="/login">
                Start Creating <Arrow />
              </a>
              <a className={styles.btnGhost} href="#workflow">
                See how it works
              </a>
            </div>
          </div>
          <HeroStage />
        </section>

        {/* 02 — THE PROBLEM ------------------------------------------- */}
        <section className={styles.section} id="problem" aria-labelledby="problem-title">
          <div className="container">
            <Reveal className={styles.sectionHead}>
              <p className={styles.kicker}>The problem</p>
              <h2 id="problem-title" className={styles.h2}>
                Great creative work
                <br />
                is not a prompting problem.
              </h2>
              <p className={styles.lede}>
                Most AI tools start with generation. Good design starts much earlier — with
                strategy, a concept, and decisions that hold together.
              </p>
            </Reveal>

            <div className={styles.compare}>
              <Reveal className={styles.compareCol} data-variant="old">
                <p className={styles.compareLabel}>The usual way</p>
                <ol className={styles.flow}>
                  {OLD_WAY.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <p className={styles.compareNote}>Four steps. Most of the thinking is skipped.</p>
              </Reveal>
              <Reveal className={styles.compareCol} data-variant="new" delay={0.08}>
                <p className={styles.compareLabel}>With Andala</p>
                <ol className={styles.flow} data-dense>
                  {ANDALA_WAY.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <p className={styles.compareNote}>
                  Generation is step eight, not step one — and a human signs off the last one.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* 03 — THE DIFFERENCE (scroll layers) --------------------- */}
        <section className={styles.sectionDark} id="difference" aria-labelledby="difference-title">
          <div className="container">
            <Reveal className={styles.sectionHead}>
              <p className={styles.kicker}>The difference</p>
              <h2 id="difference-title" className={styles.h2Light}>
                AI that thinks
                <br />
                before it prompts.
              </h2>
            </Reveal>
          </div>
          <LayerStack />
        </section>

        {/* 04 — THE WORKFLOW -------------------------------------- */}
        <section className={styles.section} id="workflow" aria-labelledby="workflow-title">
          <div className="container">
            <Reveal className={styles.sectionHead}>
              <p className={styles.kicker}>The workflow</p>
              <h2 id="workflow-title" className={styles.h2}>
                One intelligent
                <br />
                creative workflow.
              </h2>
              <p className={styles.lede}>
                Not a set of isolated AI features — one creative operating system, from the brief
                to the approved asset.
              </p>
            </Reveal>

            <Reveal className={styles.journey}>
              <svg className={styles.journeyLine} viewBox="0 0 1000 20" preserveAspectRatio="none" aria-hidden="true">
                <path d="M8 10 H992" className={styles.journeyPath} />
              </svg>
              <ol className={styles.journeySteps} data-stagger>
                {WORKFLOW_STAGES.map((stage, i) => (
                  <li key={stage} style={{ ["--i" as string]: i }}>
                    <span className={styles.journeyDot} data-key={stage === "Your Decision" ? "human" : undefined} />
                    <span className={styles.journeyLabel}>{stage}</span>
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </section>

        {/* 05 — THE AI VISUAL EMPLOYEE --------------------------- */}
        <section className={styles.section} id="employee" aria-labelledby="employee-title">
          <div className="container">
            <div className={styles.editorial}>
              <Reveal className={styles.editorialCopy} from="left">
                <p className={styles.kicker}>AI meets design intelligence</p>
                <h2 id="employee-title" className={styles.h2}>
                  Not just AI.
                  <br />
                  A visual employee
                  <br />
                  for your team.
                </h2>
                <p className={styles.lede}>
                  Andala combines strategic thinking, creative reasoning and AI production into one
                  structured workflow — studio-quality work without the trial-and-error.
                </p>
                <ul className={styles.ticks}>
                  <li>
                    <Dot tone="ink" /> Understands brand &amp; audience
                  </li>
                  <li>
                    <Dot tone="ink" /> Applies proven design principles
                  </li>
                  <li>
                    <Dot tone="ink" /> Critiques and recommends improvements
                  </li>
                  <li>
                    <Dot tone="ink" /> Keeps you in creative control
                  </li>
                </ul>
              </Reveal>

              <Reveal className={styles.editorialStack} from="right" delay={0.06}>
                <div className={styles.stackItem} data-pos="a">
                  <ConceptFrame />
                </div>
                <div className={styles.stackItem} data-pos="b">
                  <RecipeCard />
                </div>
                <div className={styles.stackItem} data-pos="c">
                  <BlueprintFrame />
                </div>
                <div className={styles.stackItem} data-pos="d">
                  <ReviewPanel compact />
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* 06 — DESIGNER + AI ---------------------------------- */}
        <section className={styles.sectionDark} id="designer" aria-labelledby="designer-title">
          <div className="container">
            <Reveal className={styles.sectionHead}>
              <p className={styles.kicker}>Designer + AI</p>
              <h2 id="designer-title" className={styles.h2Light}>
                Built for designers.
                <br />
                Not to replace them.
              </h2>
              <p className={styles.ledeLight}>
                AI handles the repetition. Designers own the idea.
              </p>
            </Reveal>

            <div className={styles.converge}>
              <Reveal className={styles.convCol} from="left">
                <p className={styles.convLabel}>AI</p>
                <ul>
                  {AI_SIDE.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </Reveal>
              <Reveal className={styles.convJoin} aria-hidden="true">
                <svg viewBox="0 0 120 120">
                  <path d="M10 20 Q60 60 60 60 Q60 60 10 100" className={styles.convPath} />
                  <path d="M110 20 Q60 60 60 60 Q60 60 110 100" className={styles.convPath} />
                  <circle cx="60" cy="60" r="9" className={styles.convCore} />
                </svg>
                <span>One creative output</span>
              </Reveal>
              <Reveal className={styles.convCol} from="right" data-variant="human">
                <p className={styles.convLabel}>Designer</p>
                <ul>
                  {HUMAN_SIDE.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </Reveal>
            </div>
          </div>
        </section>

        {/* 07 — THE CREATIVE LOOP ------------------------------ */}
        <section className={styles.section} id="loop" aria-labelledby="loop-title">
          <div className="container">
            <Reveal className={styles.sectionHead}>
              <p className={styles.kicker}>The creative loop</p>
              <h2 id="loop-title" className={styles.h2}>
                Generate. See. Improve.
              </h2>
              <p className={styles.lede}>
                The visual is observed, compared to the design intent, and given bounded correction
                options. A human decides every step — the loop never runs itself.
              </p>
            </Reveal>

            <Reveal className={styles.orbit}>
              <svg className={styles.orbitRing} viewBox="0 0 400 400" aria-hidden="true">
                <circle cx="200" cy="200" r="150" className={styles.orbitCircle} />
              </svg>
              <ul className={styles.orbitNodes}>
                {LOOP.map((label, i) => {
                  const angle = (i / LOOP.length) * Math.PI * 2 - Math.PI / 2;
                  const x = 50 + Math.cos(angle) * 42;
                  const y = 50 + Math.sin(angle) * 42;
                  return (
                    <li
                      key={label}
                      style={{ left: `${x}%`, top: `${y}%`, ["--i" as string]: i }}
                      data-control={label === "Human decision" ? "" : undefined}
                    >
                      <span className={styles.orbitDot} />
                      <span className={styles.orbitLabel}>{label}</span>
                    </li>
                  );
                })}
              </ul>
              <span className={styles.orbitCenter} aria-hidden="true">
                One cycle
                <br />
                per decision
              </span>
            </Reveal>
          </div>
        </section>

        {/* 08 — OUTPUT / CASE STUDY --------------------------- */}
        <section className={styles.section} id="output" aria-labelledby="output-title">
          <div className="container">
            <Reveal className={styles.sectionHead}>
              <p className={styles.kicker}>The output</p>
              <h2 id="output-title" className={styles.h2}>
                Brief in. Considered creative out.
              </h2>
              <p className={styles.lede}>An illustrative walk-through — the shape of the work, not a client case.</p>
            </Reveal>

            <div className={styles.caseRow}>
              <Reveal className={styles.caseCol} from="left">
                <span className={styles.caseTag}>Concept</span>
                <ConceptFrame />
              </Reveal>
              <Reveal className={styles.caseCol} data-hero delay={0.06}>
                <span className={styles.caseTag}>Generated visual</span>
                <div className={styles.caseVisual} aria-hidden="true">
                  <svg viewBox="0 0 240 300">
                    <rect x="0" y="0" width="240" height="300" rx="16" className={styles.caseBg} />
                    <rect x="0" y="0" width="240" height="180" rx="16" className={styles.caseImg} />
                    <path
                      d="M60 150c14-52 24-70 30-70s16 18 30 70"
                      className={styles.caseObj}
                      fill="none"
                    />
                    <circle cx="120" cy="86" r="10" className={styles.caseObjDot} />
                    <rect x="24" y="204" width="150" height="12" rx="4" className={styles.caseLine} />
                    <rect x="24" y="228" width="96" height="10" rx="4" className={styles.caseLine} />
                  </svg>
                </div>
              </Reveal>
              <Reveal className={styles.caseCol} from="right" delay={0.12}>
                <span className={styles.caseTag}>Review &amp; decision</span>
                <ReviewPanel />
                <DecisionCard />
              </Reveal>
            </div>
          </div>
        </section>

        {/* 09 — FOR THE TEAM ------------------------------- */}
        <section className={styles.section} id="team" aria-labelledby="team-title">
          <div className="container">
            <Reveal className={styles.sectionHead}>
              <p className={styles.kicker}>For the team</p>
              <h2 id="team-title" className={styles.h2}>
                One creative system.
                <br />
                For the whole team.
              </h2>
            </Reveal>

            <ul className={styles.teamGrid}>
              {TEAM.map((t, i) => (
                <Reveal as="li" key={t.role} className={styles.teamCard} delay={i * 0.05}>
                  <p className={styles.teamRole}>{t.role}</p>
                  <p className={styles.teamSees}>{t.sees}</p>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* 10 — FINAL CTA -------------------------------- */}
        <section className={styles.cta} aria-labelledby="cta-title">
          <div className="container">
            <Reveal>
              <h2 id="cta-title" className={styles.ctaTitle}>
                Better thinking.
                <br />
                Better creative.
                <br />
                Better teams.
              </h2>
              <p className={styles.ctaSub}>Build with AI. Direct with taste.</p>
              <div className={styles.heroActions}>
                <a className={styles.btnPrimary} href="/login">
                  Start Creating <Arrow />
                </a>
                <a className={styles.btnGhost} href="#workflow">
                  Explore the workflow
                </a>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className="container">
          <div className={styles.footerInner}>
            <span className={styles.brand}>
              <span className={styles.brandMark} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path d="M12 3 21 20H3Z" fill="currentColor" />
                </svg>
              </span>
              Andala
            </span>
            <p className={styles.footerLine}>
              An AI graphic designer that thinks before it prompts. Private team workspace.
            </p>
            <a className={styles.footerLink} href="/login">
              Sign in
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Arrow() {
  return (
    <svg className={styles.arrow} viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M2 8h10M8 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
