import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { VisionObservationPayload } from "../../../ports/visual-evidence.port";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

/**
 * Load a synthetic vision-observation payload — the raw structured shape a
 * vision provider returns. Parsed against the port schema so a malformed
 * fixture fails loudly.
 */
export function loadObservationPayload(name: string): VisionObservationPayload {
  const raw = JSON.parse(readFileSync(join(ROOT, `${name}.json`), "utf8")) as unknown;
  return VisionObservationPayload.parse(raw);
}
