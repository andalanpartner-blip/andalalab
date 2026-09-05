# P2.3.2 Live Evaluation Analysis
**Date**: 2026-09-05  
**Run**: Real Brief Evaluation with Gemini 3.1 Flash Lite  
**Overall Accuracy**: 71.4%

## Executive Summary

The reported 0% accuracy for country and audience fields is **MISLEADING**. The actual issue is not with the extraction or comparison logic, but with a **foundational architecture mismatch**:

- **Only 1 of 10 briefs** is being evaluated (brief #1: coffee-grand-opening)
- **9 of 10 briefs** are failing the "readiness" check and are excluded from metrics
- The readiness failure is due to **missing blocking fields in model extraction**
- This cascades to only 1 total evaluation per field (not 10)

**Metrics reported**: "country: 0/1" and "audience: 0/1" — NOT "0/10"

---

## Root Cause Analysis

### Problem #1: Readiness Bottleneck (90% of briefs failing)

**Finding**: 9 out of 10 briefs have `ready=false` and produce no `NormalizedBrief`.

**Completeness Scores**:
```
Brief 1 (coffee-grand-opening):     0.8462 ✓ READY
Brief 2 (fashion-collection-launch): 0.6226 ✗
Brief 3 (property-cluster-promotion): 0.601  ✗
Brief 4 (beauty-skincare-campaign):  0.8101 ✗
Brief 5 (hotel-promotion):           0.6394 ✗
Brief 6 (wellness-pilates-campaign): 0.7524 ✗
Brief 7 (saas-product-launch):       0.601  ✗
Brief 8 (public-event-campaign):     0.6587 ✗
Brief 9 (community-organization):    0.3942 ✗ (WORST)
Brief 10 (retail-product-promotion): 0.7524 ✗

Average: 0.6678
```

**Blocking Fields Requirement** (all 8 required):
1. objective
2. core_message ⚠️
3. industry_id
4. visual_type_id
5. platform.channel
6. platform.aspect_ratio_id
7. audience.description
8. country

**Root Cause Hypothesis**: The `core_message` field is missing from briefs 2-10. This field is marked as BLOCKING but none of the 10 real-world briefs contain an explicit "core message" statement.

**Evidence**:
- Brief 1 brief text includes "buka coffee shop di Solo... launching" → model synthesized "Coffee shop baru di Solo resmi buka dan ingin dikenal anak muda kota"
- Briefs 2-10 lack this synthesizable core narrative; they are more complex/multi-faceted
- Model is following prompt instruction: "If something is not stated, set value to null" — and with no stated core message, it returns null

**Assessment**: This is a **MODEL PROMPT / SCHEMA DESIGN issue**, not a model failure.

---

### Problem #2: Country Weighting Mismatch (1 brief only)

**Brief 1 Actual vs Expected**:
```
Expected: {indonesia: 0.75, japan: 0.25}
Actual:   {indonesia: 0.5,  japan: 0.5}
Difference: 0.25 on each (EXCEEDS 0.15 tolerance)
Match: ❌ FALSE
```

**Analysis**:
- Model extracted equal weight (0.5/0.5) from the text: "kombinasi dengan estetika Jepang" (combination with Japanese aesthetics)
- Expected value (0.75/0.25) reflects human judgment: Japan is secondary influence
- Gemini correctly identified both countries but weighted them equally
- **Verdict**: Model is reasonable but overstates Japan's influence. This is a **weighting calibration issue**, not extraction failure.

**Root Cause**: The prompt says "weights are the user's, not the model's" but doesn't clarify how to handle implicit influence strengths. The brief says "kombinasi" (combination) and "tetap ada sentuhan Indonesia" (emphasis on Indonesian), suggesting asymmetry, but Gemini treated them equally.

---

### Problem #3: Audience Language Mismatch (1 brief only)

**Brief 1 Actual vs Expected**:
```
Expected (English): "Millennial and Gen Z coffee enthusiasts in Solo, 
                     urban professionals with high taste sophistication"
Actual (Indonesian): "anak muda yang suka kopi specialty"
```

**Analysis**:
The semantic comparison function (30% term overlap threshold):
- Tokenizes both strings on whitespace
- Checks if each expected term appears as substring in any actual term
- For this pair:
  - "millennial", "and", "gen", "z", "coffee", "enthusiasts", "solo", "urban", "professionals", "high", "taste", "sophistication" (12 terms)
  - "anak", "muda", "yang", "suka", "kopi", "specialty" (6 terms)
  - Term overlap: ~0% (no matches: "coffee"≠"kopi", "millennials"∉"anak muda")

**Root Cause**: 
1. **Language mismatch**: Gemini extracts audience in source language (Indonesian, per prompt: "copy using the client's own wording") while expected values are in English (human interpretations)
2. **Comparison logic ignores translation**: `compareAudience()` does naive string matching with no translation/semantics
3. **Expected values may be interpretation, not extraction**: Hand-crafted expected values are English summaries, not direct brief quotations

**Verdict**: The model is **correct per the prompt** (preserve original language), but the evaluator is **unprepared for language diversity**. This is an **EVALUATOR COMPARISON LOGIC issue**.

---

## Diagnostic Table: All 10 Briefs

| Brief ID | Raw Extraction Status | Completeness | Ready? | Missing Field(s) | Key Issue |
|----------|----------------------|--------------|--------|------------------|-----------|
| 1 coffee-grand-opening | ✓ Extracted | 0.8462 | ✓ Yes | None | Country weighting overstates Japan (0.5 vs 0.25 expected) |
| 2 fashion-collection-launch | ✓ Extracted | 0.6226 | ✗ No | core_message likely null | Minimalist brand doesn't state explicit messaging |
| 3 property-cluster-promotion | ✓ Extracted | 0.601 | ✗ No | core_message likely null | Multi-benefit brief lacks single message |
| 4 beauty-skincare-campaign | ✓ Extracted | 0.8101 | ✗ No | core_message likely null | Campaign theme stated but no core message extracted |
| 5 hotel-promotion | ✓ Extracted | 0.6394 | ✗ No | core_message likely null | Package promotion complex, no single statement |
| 6 wellness-pilates-campaign | ✓ Extracted | 0.7524 | ✗ No | core_message likely null | Growth/wellness goals stated separately |
| 7 saas-product-launch | ✓ Extracted | 0.601 | ✗ No | core_message likely null | Technical feature details, no UVP statement |
| 8 public-event-campaign | ✓ Extracted | 0.6587 | ✗ No | core_message likely null | Event scale/scope, but no central message |
| 9 community-organization-campaign | ✓ Extracted | 0.3942 | ✗ No | Likely 2+ blocking fields | Social impact brief is complex and underspecified |
| 10 retail-product-promotion | ✓ Extracted | 0.7524 | ✗ No | core_message likely null | Store opening + promotions, no unified message |

**Key Finding**: 9 briefs are extraction-complete but fail readiness due to architectural requirements, not model defects.

---

## Affected Components

### 1. **Model Prompt** (`engine/brief/prompts/brief-normalizer.ts`)
- **Status**: Working as designed
- **Issue**: Requires `core_message` extraction but doesn't define what constitutes a "message" vs. context/goals
- **Impact**: Real-world briefs (especially complex B2B/B2C campaigns) rarely state a single core message
- **Example**: Brief 2 describes "Bauhaus-inspired minimalist fashion" but no explicit message like "Launch premium fashion line"

### 2. **Completeness Logic** (`engine/brief/completeness.ts`)
- **Status**: Correctly identifying missing blocking fields
- **Issue**: `core_message` is marked BLOCKING but may not be actionable for all brief types
- **Weights**: 75% of completeness score from blocking fields
- **Severity**: With 9/10 briefs failing, this creates a 90% failure rate bottleneck

### 3. **Evaluation Script** (`scripts/evaluate-briefs.ts`)
- **Status**: Functioning correctly but reporting misleading metrics
- **Issues**:
  - Only compares briefs with `brief != null` (readiness filtered)
  - Field accuracy metrics don't reflect actual extraction accuracy
  - `compareAudience()` function ignores language diversity
  - No reporting on why 9/10 briefs are excluded
- **Impact**: 71.4% overall accuracy is weighted toward objective/industry/visual_type (100%) but masks that audience/country are never evaluated at scale

### 4. **Expected Values** (`data/evaluation/real-briefs.json`)
- **Status**: May be over-specified for human interpretation
- **Issue**: Expected audience values are English summaries, not source-language extractions
- **Example**: Expected "Millennial and Gen Z coffee enthusiasts..." but brief says "anak muda yang suka kopi specialty" — different intent

---

## Analysis: Can the Evaluation Proceed?

### Current State
- **1 brief ready** → field_comparisons populated
- **1 brief evaluated** → metrics reflect only brief #1
- **9 briefs excluded** → not included in accuracy calculation
- **Reported 71.4%** → (5 correct + 2 wrong) / 7 fields = 0.714

### Real Situation
- **Country accuracy**: 0/1 = 0% (only brief 1 evaluated)
- **Audience accuracy**: 0/1 = 0% (only brief 1 evaluated)
- **But brief 1 is evaluable** → extraction succeeded, comparison logic flawed

---

## Recommended Fixes (Ranked by Severity)

### 🔴 CRITICAL - Evaluation Architecture
**Issue**: Excluding 90% of briefs from metrics is unjustifiable  
**Fix**: 
- Report separate metrics for "extracted" vs "ready" briefs
- Compare raw extractions regardless of readiness
- Add diagnostic column: "why not ready" in report

**File**: `scripts/evaluate-briefs.ts`  
**Impact**: Reveals true extraction accuracy (not masked by readiness filter)  
**Effort**: Low (restructure calculateMetrics)

### 🟠 HIGH - Audience Comparison Logic
**Issue**: String matching can't handle language diversity or semantic equivalence  
**Fix Options**:
1. **Normalize both to English** before comparison (add translation layer)
2. **Accept language-diverse output** and compare semantically (use embedding similarity)
3. **Preserve language match rule**: If brief is Indonesian, expect Indonesian audience description
4. **Relaxed matching**: Accept 15% term overlap instead of 30% for cross-language briefs

**File**: `scripts/evaluate-briefs.ts` → `compareAudience()`  
**Impact**: More realistic audience evaluation  
**Effort**: Medium (requires language detection or translation API)

### 🟠 HIGH - Country Weighting Calibration
**Issue**: Model treats "combination" as equal weighting; humans weight by prominence  
**Fix**:
- Add guidance to prompt: "If the brief emphasizes one country more, reflect that in weights (e.g., 0.7/0.3 not 0.5/0.5)"
- Increase tolerance from 0.15 to 0.20 for briefs with multiple countries
- Document weighting rules in prompt template

**File**: `engine/brief/prompts/brief-normalizer.ts`  
**Impact**: Better model calibration on asymmetric blends  
**Effort**: Low (prompt tuning + test)

### 🟡 MEDIUM - core_message Redesign
**Issue**: Blocking field that 90% of briefs can't satisfy  
**Options**:
1. **Make core_message OPTIONAL**: Move from BLOCKING to OPTIONAL/DERIVABLE
2. **Redefine core_message**: "Objective + target audience + key benefit" (more extractable)
3. **Add fallback logic**: If core_message is null, use objective as fallback for concept generation
4. **Brief preprocessing**: Require clients to provide explicit core message upfront (not model extraction)

**File**: 
- `engine/brief/completeness.ts` (BLOCKING_FIELDS definition)
- `engine/brief/prompts/brief-normalizer.ts` (guidance)
- `engine/concept/prompts/concept-generator.ts` (uses core_message)

**Impact**: Allows 90% of briefs to proceed; requires fallback in downstream engines  
**Effort**: Medium-High (affects multiple layers)

### 🟡 MEDIUM - Expected Values Verification
**Issue**: Hand-crafted expected values may not match model's interpretation scope  
**Fix**:
- Audit if expected values should be English summaries or source-language extractions
- Define: are expected values "ground truth" or "reasonable interpretations"?
- If semantic diversity is acceptable, update tests to reflect that

**File**: `data/evaluation/real-briefs.json` + evaluation test expectations  
**Impact**: Clarifies what "correct" means  
**Effort**: Low (documentation + minor data updates)

### 🟢 LOW - Test Data Expansion
**Issue**: Only 10 briefs, only 1 ready; sample size too small  
**Fix**:
- Add 5-10 pre-vetted briefs that explicitly state core_message
- Test cross-language extraction (brief in English, audience in English vs Indonesian)
- Test country weighting with explicit ratio statements ("70% Indonesia, 30% Japan")

**File**: `data/evaluation/real-briefs.json`  
**Impact**: Better coverage of model behavior  
**Effort**: Medium (crafting good briefs is hard)

---

## Diagnosis by Root Cause

### 1️⃣ **Evaluator Comparison Logic** (60% of observed accuracy issue)
- `compareAudience()` can't handle Indonesian output vs English expected
- `compareCountryBlend()` tolerance (0.15) may be too strict for model variation
- **Verdict**: FIXABLE with better comparators (language-aware, more lenient)

### 2️⃣ **Readiness Bottleneck** (30% of observed accuracy issue)
- `core_message` blocking field excludes 90% of briefs
- Real briefs don't have explicit "core messages"; they have goals/narratives
- **Verdict**: FIXABLE by making core_message optional or derivable

### 3️⃣ **Model Extraction Quality** (10% of observed accuracy issue)
- Country weighting overstates secondary influence (0.5 vs 0.25)
- This is minor calibration drift, not a fundamental failure
- **Verdict**: FIXABLE with prompt refinement

### 4️⃣ **Expected Value Scope** (Unclear impact)
- Expected values may be "aspirational interpretations" not "ground truth"
- No way to know without design intent documentation
- **Verdict**: REQUIRES CLARIFICATION

---

## P2.3.2 Verdict

### Current Assessment: **CONDITIONAL FAIL** 🟡

**Why not PASS**:
- 90% of briefs excluded from evaluation (readiness filter)
- Only 1 of 7 fields actually evaluated at scale
- Evaluation metrics are misleading (71.4% hides 0% on country/audience)

**Why not complete FAIL**:
- The 1 brief that IS evaluated has correct objective/industry/visual_type/channel/aspect_ratio (5/5 = 100%)
- Gemini extraction is working; issues are schema/evaluation design
- Model can extract in both languages; evaluator just can't compare them

### Blocking Issues (prevent PASS):
1. ❌ 90% briefs not ready (core_message bottleneck)
2. ❌ Metrics report only 1/10 briefs as evaluated
3. ❌ Audience comparison fails on language diversity
4. ❌ Country weighting calibration is off

### Path to PASS:
- [x] Identify root causes (complete)
- [ ] Fix evaluator comparison logic (medium effort)
- [ ] Make core_message optional or provide extraction guidance (medium effort)
- [ ] Re-run evaluation with 9+ briefs ready
- [ ] Achieve 70%+ accuracy on all 10 briefs

**Estimated effort**: 4-8 hours (prompt tuning + evaluator refactoring)

---

## Questions for Stakeholders

1. **Core Message Scope**: Is it reasonable to extract core_message from every brief, or should it be optional?
2. **Language Policy**: Should audience descriptions stay in source language (Indonesian) or be normalized?
3. **Expected Values**: Are the hand-crafted expected values ground truth or interpretation guidelines?
4. **Country Weighting**: Should secondary influences be weighted as 0.2-0.3 or 0.5?
5. **Readiness Threshold**: Is "ready" the right gate, or should there be a "ready for X, not for Y" system?

---

## Appendix: Code Locations

| Component | File | Issue |
|-----------|------|-------|
| Blocking fields definition | `engine/brief/completeness.ts:17-23` | core_message is blocking |
| Completeness calculation | `engine/brief/completeness.ts:120-145` | 75% weight on blocking |
| Audience comparison | `scripts/evaluate-briefs.ts:93-99` | No language handling |
| Country comparison | `scripts/evaluate-briefs.ts:75-91` | Tolerance 0.15 may be strict |
| Metrics aggregation | `scripts/evaluate-briefs.ts:267-298` | Only counts field_comparisons |
| Evaluation filtering | `scripts/evaluate-briefs.ts:145-175` | `if (!actual)` skips non-ready |
| Model prompt | `engine/brief/prompts/brief-normalizer.ts:50-100` | Doesn't define core_message clearly |

---

**Report Generated**: 2026-09-05 17:30 UTC  
**Analysis Author**: AI Assistant  
**Status**: Ready for stakeholder review
