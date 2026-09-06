import { datasets, pipeline } from "./load";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { FAKE_PLACEHOLDER_PNG_BASE64 } from "../../adapters/visual-generation/fake";

/**
 * P2.19 — a small representative fixture set spanning different visual
 * contexts, built ENTIRELY from existing datasets and existing brief fixtures.
 * No new datasets. Purpose: architectural regression + workflow reliability,
 * NOT creative benchmarking.
 */
export const PRODUCTION_SCENARIOS = [
  { name: "kopi-lawas-promotion", label: "poster / social — F&B promotion" },
  { name: "northbeam-saas-launch", label: "product / marketing — SaaS launch" },
  { name: "tokyo-fashion-editorial", label: "editorial / fashion" }
] as const;

export type ScenarioName = (typeof PRODUCTION_SCENARIOS)[number]["name"];

export const SCENARIO_IMAGE_BASE64 = FAKE_PLACEHOLDER_PNG_BASE64;

/** contract → direction → recipe → blueprint for a scenario. */
export function scenarioBase(name: ScenarioName) {
  const p = pipeline(name);
  const bp = resolveLayoutBlueprint({
    recipe: p.recipe,
    contract: p.contract,
    direction: p.direction,
    datasets
  });
  if (!bp.ok) throw new Error(`${name}: blueprint did not resolve`);
  return { ...p, blueprint: bp.value };
}
