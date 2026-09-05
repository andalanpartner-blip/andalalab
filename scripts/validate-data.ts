#!/usr/bin/env tsx
/**
 * Dataset validation gate.
 *
 * Run in CI on every commit. If this fails, the build fails — reference data is
 * treated as source code, because it is: the whole product's behaviour is
 * determined by these files.
 */
import { DatasetValidationError, loadDatasets, summariseDatasets } from "../data/loader";
import { positiveFieldText, mentionsToken } from "../engine/country/anti-stereotype";

function main(): void {
  let registry;
  try {
    registry = loadDatasets();
  } catch (error) {
    if (error instanceof DatasetValidationError) {
      console.error("\n✗ Dataset validation FAILED\n");
      for (const detail of error.issues) console.error(`  • ${detail}`);
      console.error(`\n${error.issues.length} issue(s).\n`);
      process.exit(1);
    }
    throw error;
  }

  // Self-contradiction check: a country must not use, in its own descriptive
  // fields, a token it declares as a stereotype to avoid.
  const contradictions: string[] = [];
  for (const country of registry.countries.values()) {
    const positive = positiveFieldText(country);
    for (const entry of country.avoid_stereotypes) {
      if (mentionsToken(positive, entry.token)) {
        contradictions.push(
          `countries/${country.id} declares "${entry.token}" as a stereotype to avoid but uses it in its own descriptive fields`
        );
      }
    }
  }

  if (contradictions.length > 0) {
    console.error("\n✗ Anti-stereotype self-consistency FAILED\n");
    for (const detail of contradictions) console.error(`  • ${detail}`);
    console.error("");
    process.exit(1);
  }

  const summary = summariseDatasets(registry);
  console.log(`\n✓ Dataset ${registry.version} valid\n`);
  for (const [name, count] of Object.entries(summary)) {
    console.log(`  ${name.padEnd(12)} ${count}`);
  }
  const tokens = [...registry.countries.values()].reduce(
    (total, country) => total + country.avoid_stereotypes.length,
    0
  );
  console.log(`  ${"banned tokens".padEnd(12)} ${tokens}\n`);
}

main();
