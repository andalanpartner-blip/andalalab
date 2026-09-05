import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConceptProposalBatch } from "../../../types/schemas/concept.schema";

export const conceptFixtureText = (name: string): string =>
  readFileSync(join(process.cwd(), "tests/fixtures/concepts", `${name}.json`), "utf8");

export const conceptFixture = (name: string) =>
  ConceptProposalBatch.parse(JSON.parse(conceptFixtureText(name)));
