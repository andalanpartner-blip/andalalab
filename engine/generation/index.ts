/**
 * Public surface of the Visual Generation engine layer (P2.11).
 *
 * Pure: it builds and hashes the normalised generation request from
 * already-resolved artifacts. It knows nothing about providers, credentials or
 * the network — that all lives behind `VisualGenerationPort` in
 * `adapters/visual-generation/**`.
 */
export {
  buildGenerationRequest,
  PROMPT_COMPILER_VERSION,
  GENERATION_REQUEST_VERSION,
  type BuildGenerationRequestInput
} from "./request";
