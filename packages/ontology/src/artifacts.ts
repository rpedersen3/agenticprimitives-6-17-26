// Node-only artifact loaders for @agenticprimitives/ontology.
//
// Subpath: `@agenticprimitives/ontology/artifacts`. Uses `node:url` + the
// filesystem, so it is NOT browser-bundleable — import it ONLY server-side (a
// SPARQL loader / SHACL engine). The browser-safe IRI constants are the main
// entry (`@agenticprimitives/ontology`).

import { fileURLToPath } from 'node:url';

/**
 * Relative paths (from the package root) of the shipped vocabulary artifacts.
 * Resolve to an absolute filesystem path with {@link artifactPath} and load into
 * a SPARQL store / SHACL engine.
 */
export const ARTIFACTS = {
  context: 'context.jsonld',
  tbox: [
    // Phase-1 (identity + core)
    'tbox/core.ttl',
    'tbox/identity.ttl',
    // Phase-1.5 (v2 coordination substrate spine; spec 225 §11.5)
    'tbox/intents.ttl',
    'tbox/constraints.ttl',
    'tbox/resolution.ttl',
    'tbox/agreement.ttl',
    'tbox/payment.ttl',
    'tbox/fulfillment.ttl',
    'tbox/attestation.ttl',
  ],
  cbox: ['cbox/canonical-agent-id-shape.shacl.ttl', 'cbox/controlled-vocabularies.ttl'],
  mappings: ['mappings/spine-standards.ttl'],
} as const;

/**
 * Resolve a shipped artifact's relative path (see {@link ARTIFACTS}) to an
 * absolute filesystem path. Works in dev (from `src/`) and after build (from
 * `dist/`) — the artifacts ship at the package root in both cases.
 */
export function artifactPath(relativePath: string): string {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
}
