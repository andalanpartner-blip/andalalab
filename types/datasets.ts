import type { CountryDNA } from "./schemas/reference/country.schema";
import type { DesignMovement } from "./schemas/reference/movement.schema";
import type { IndustryDNA } from "./schemas/reference/industry.schema";
import type { LayoutSystem } from "./schemas/reference/layout.schema";
import type { ConceptLexicon } from "./schemas/reference/lexicon.schema";
import type { VisualType } from "./schemas/reference/visual-type.schema";
import type { DatasetVersion } from "./primitives";

/**
 * The reference data the engine operates on, INJECTED rather than imported.
 *
 * This type lives in `types/` (not `data/`) precisely so the engine can depend
 * on it without ever being able to reach the loader, which touches the file
 * system. Purity is enforced by ESLint; this is the shape that makes obeying
 * the rule easy.
 */
export type DatasetRegistry = {
  readonly version: DatasetVersion;
  readonly countries: ReadonlyMap<string, CountryDNA>;
  readonly movements: ReadonlyMap<string, DesignMovement>;
  readonly industries: ReadonlyMap<string, IndustryDNA>;
  readonly visualTypes: ReadonlyMap<string, VisualType>;
  readonly layouts: ReadonlyMap<string, LayoutSystem>;
  readonly lexicons: ReadonlyMap<string, ConceptLexicon>;
};

export type DatasetKind = "countries" | "movements" | "industries" | "visualTypes" | "layouts";
