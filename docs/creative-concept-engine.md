# Creative Concept Engine

Turns a Design Direction into three creative concepts, then selects one — all
under the doctrine **the model proposes, the engine disposes**.

## Purpose

By the time this engine runs, the deterministic pipeline has already decided the
movement, the layout grammar, the DKV targets and the cultural blend. What it
cannot decide is the *idea*: what is actually in the frame, what tension it runs
on, why that serves the objective. That is what a model is for.

## Lifecycle

```
DesignDirection
  → buildConceptPrompt()      brief / direction / concept, in that order
  → LlmPort                   call 1: 3 proposals
  → validateConcept()         generic · specificity · constraints · culture
  → buildDiversityVector()    categorical + lexical signature
  → assessDiversity()         pairwise gate, floor 0.35
  → [call 2, only the failures]
  → scoreConcept()            9 deterministic dimensions
  → select highest            ties break on id
  → lockConceptAnchor()
  = DesignRecipe.concept_ref
```

## Model vs engine

| The model may | The engine decides |
|---|---|
| propose ideas and write the narrative | whether an idea is specific enough |
| choose a concept type from 12 | whether two ideas are actually different |
| declare strategy labels | the authoritative score |
| suggest a `self_score` | which concept is selected |

`self_score` is stored as `model_advisory` and never used. A model scoring its
own output is grading its own homework.

## Two shapes, deliberately

`ConceptProposal` is what the model may say. `CreativeConcept` is what the engine
has decided: proposal + diversity vector + deterministic score + hash. The
proposal schema is `.strict()`, so a model that volunteers `dkv` or `layout_id`
is rejected rather than obeyed.

## Generic rejection

Two independent defences, because phrase matching alone is trivially evaded.

**Banned phrases** live in `data/lexicons/concept-language.json` — versioned
data, not code, so tuning is a diff and not a deploy.

**Specificity** is measured by ratio, never by length:

- concrete word count (styling and mood words removed)
- lexical variety — unique over total
- styling ratio — how much of the text is colour, light, lens and type
- **vagueness ratio as a multiplier**, not a fourth averaged term

The multiplier matters. Prose that is 70% mood adjectives once scored 0.71 under
an additive formula because it used enough distinct words while saying nothing.
Fluent emptiness is usually long, so length can never be the measure.

## Diversity

Three concepts differing only in palette are one concept and two repaints.

**Defence one: the lexical signature.** All styling vocabulary — beige, cream,
softbox, 85mm, serif, gradient — is stripped before comparison, so a repaint has
nowhere to hide. Two concepts with identical ideas and different palettes have
identical signatures and score a distance near zero.

**Defence two: mixed features.** The vector combines labels the model declares
with a metaphor family the engine derives from the text. Declared labels alone
could be gamed: relabel the same paragraph as a different type and it would pass.
The lexical term carries the highest single weight (0.18) precisely because it is
the one feature the model cannot relabel its way out of.

Distance is weighted across concept type, metaphor family, subject strategy,
narrative strategy, composition intent, emotional strategy, human presence,
abstraction level (ordinal, scaled) and the lexical term. Floor:
`MIN_CONCEPT_DISTANCE = 0.35`, in `engine/concept/config.ts` — one location.

## Regeneration

One generation call, plus at most one targeted regeneration. Never a third.

Only the failures are regenerated; accepted concepts are kept and quoted back in
the repair prompt so the model cannot simply restate one. Regenerating all three
because one was a duplicate would throw away work the engine already approved.

If a duplicate survives the second call it is **dropped, not shipped**. A short
list of real concepts beats three where two are the same.

## Selection

Nine deterministic dimensions: strategic relevance (0.20), audience relevance
(0.15), industry fit (0.13), originality (0.12), brand fit (0.10), visual
potential (0.10), cultural coherence (0.10), platform suitability (0.06),
production feasibility (0.04). A dimension with no evidence — brand fit with no
brand — is marked inapplicable and its weight redistributed, exactly as candidate
scoring does in P1.

## Cultural safety

Reuses the `avoid_stereotypes` guard already authored in the country files, so
there is one stereotype list in the system rather than two that drift. Each entry
carries `why` and `instead`, which become the issue's reason and fix — the
rejection tells the model what to do next, not merely no.

Three checks: stereotype tokens for countries **in** the blend
(`CULTURAL_STEREOTYPE`), tokens belonging to countries **not** in the blend
(`INVENTED_CULTURAL_CLAIM`), and country-equals-a-look phrases from the lexicon.

The prompt states the positive rule too: a minority culture may appear as
restraint, reduction, material choice or spatial calm — never as a symbol,
script, flower, pattern or landmark.

## Concept anchor

Locked to `<concept id>@<concept hash>` using the same anchor mechanism as every
other anchor. There is no parallel system for concepts.

The hash is what gives it teeth: swapping a different concept in, or editing the
idea in place under the same id, both change the hash and both trip
`assertAnchorsIntact`. An id alone would let the idea be rewritten underneath the
anchor unnoticed.

With a concept selected, no anchor remains `pending`.

## Known limitations

1. **Validation is lexical, not semantic.** It reliably catches filler, repaint
   and cliché. It cannot tell a brilliant idea from a competent one — that
   judgement stays with a human, and the engine's job is to keep anything
   obviously broken away from them.
2. **A paraphrased duplicate can pass.** Two genuinely identical ideas written in
   different vocabulary will score as distinct. Real embeddings would fix this
   and are deliberately out of scope here.
3. **Concepts are generated in English.** The banned-phrase and vagueness lists
   are English; Indonesian concept output needs an Indonesian lexicon first.
4. **Movement-name detection is data-driven (P7).** `checkConstraints` iterates
   `datasets.movements` and matches each on its `id`, its display `name` and its
   data-authored `aliases`. A new movement file needs no code change.
5. **Cultural checking is token matching**, not interpretation. A stereotype
   expressed without using any listed token passes.
6. **No live model has ever run this.** All fixtures are hand-written. Whether a
   real model produces three genuinely distinct concepts under these constraints
   is untested.
7. **The P2.1 minority-culture finding is unresolved.** At 75/25 the minority
   country still owns no dimension in the recipe. This engine gives it a route
   back in — cultural coherence rewards a concept that carries the minority
   influence — but that is a mitigation, not a fix. The dimension-weighting
   change belongs to P1 and was deliberately not made here.
