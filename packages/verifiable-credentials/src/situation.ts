/**
 * DOLCE+DnS Situation pattern — the substrate's typed base for every credential
 * subject. Per spec 242 §5: substrate credentials describe a `Situation` with
 * a `Description`, `Roles`, and `Participants`.
 *
 *   Situation     — the thing the credential is about (e.g. "this agreement",
 *                   "this validation result", "this evidence anchor")
 *   Description   — the typed shape spec the situation conforms to (SHACL IRI)
 *   Roles         — typed slots filled by participants (e.g. issuer, holder,
 *                   beneficiary, validator)
 *   Participants  — the SAs filling each role
 *
 * Owning vocabularies define their specific Situation subclasses; this module
 * exports the substrate base types every consumer composes against.
 */

import type { Address } from '@agenticprimitives/types';

/** Ontology IRI of the Description shape (e.g. `apagr:AgreementCredential`). */
export type DescriptionRef = `${string}:${string}`;

/** Role identifier — local name within a Description. */
export type RoleName = string;

/** A typed Situation as a credential subject. The `[k: string]: unknown`
 *  index signature lets it satisfy `VerifiableCredential`'s `TSubject` constraint
 *  while keeping the typed `description / roles / body` fields tight. */
export interface Situation<TBody extends Record<string, unknown> = Record<string, unknown>> {
  /** The Description shape the situation conforms to. */
  description: DescriptionRef;
  /** Typed slots — `{ roleName → AgentSA }`. */
  roles: Record<RoleName, Address>;
  /** Optional non-Agent participants (e.g. resource IRIs, document hashes). */
  participants?: Record<string, string>;
  /** The situation-specific payload. */
  body: TBody;
  /** Index signature so Situation satisfies VC's TSubject constraint. */
  [key: string]: unknown;
}

/**
 * Validate that a Situation declares the roles its Description requires.
 * Used by SDK helpers before signing; production validation runs SHACL.
 */
export function assertSituationRolesPresent(s: Situation, requiredRoles: RoleName[]): void {
  const have = new Set(Object.keys(s.roles));
  const missing = requiredRoles.filter((r) => !have.has(r));
  if (missing.length > 0) {
    throw new Error(
      `[verifiable-credentials] Situation '${s.description}' is missing required roles: ${missing.join(', ')}`,
    );
  }
}

/** Convenience constructor — builds the situation envelope from typed bits. */
export function buildSituation<TBody extends Record<string, unknown>>(args: {
  description: DescriptionRef;
  roles: Record<RoleName, Address>;
  body: TBody;
  participants?: Record<string, string>;
}): Situation<TBody> {
  return {
    description: args.description,
    roles: { ...args.roles },
    participants: args.participants ? { ...args.participants } : undefined,
    body: args.body,
  };
}
