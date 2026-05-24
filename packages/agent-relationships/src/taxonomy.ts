/**
 * Relationship-type taxonomy + semantics map.
 *
 * Subpath: `@agenticprimitives/agent-relationships/taxonomy`.
 *
 * Each entry describes the structural properties downstream resolvers
 * need to know to traverse the edge graph correctly:
 *
 * - `hierarchical` — induces parent/child semantics (e.g. governance).
 * - `transitive`   — `(A→B) ∧ (B→C) ⇒ (A→C)` for the purposes of
 *                    membership inference. Use with caution.
 * - `symmetric`    — bidirectional by definition (e.g. PARTNERSHIP);
 *                    a single PROPOSED side activates the edge.
 *
 * These flags are descriptive (off-chain logic acts on them); the
 * on-chain contract (Phase 3) enforces the two-side-confirmation
 * rule independently for non-symmetric types.
 */

import { RELATIONSHIP_TYPE, ROLE, hashRelationshipType, hashRole } from './constants';
import type { Hex } from '@agenticprimitives/types';

export { RELATIONSHIP_TYPE, ROLE, hashRelationshipType, hashRole };

export interface RelationshipTypeSemantics {
  /** Canonical name (the pre-image of the bytes32 type ID). */
  name: string;
  /** Whether traversal induces a parent/child relationship. */
  hierarchical: boolean;
  /** Whether membership inference is transitive across this edge. */
  transitive: boolean;
  /** Whether the edge is bidirectional by definition. */
  symmetric: boolean;
  /** One-line documentation string. */
  description: string;
}

export const TYPE_SEMANTICS: Readonly<Record<Hex, RelationshipTypeSemantics>> = Object.freeze({
  [RELATIONSHIP_TYPE.HAS_MEMBER]: {
    name: 'HAS_MEMBER',
    hierarchical: false,
    transitive: false,
    symmetric: false,
    description: 'Subject is a member of object (org / DAO / collective).',
  },
  [RELATIONSHIP_TYPE.HAS_GOVERNANCE_OVER]: {
    name: 'HAS_GOVERNANCE_OVER',
    hierarchical: true,
    transitive: false,
    symmetric: false,
    description: 'Subject has governance authority over object.',
  },
  [RELATIONSHIP_TYPE.VALIDATION_TRUST]: {
    name: 'VALIDATION_TRUST',
    hierarchical: false,
    transitive: false,
    symmetric: false,
    description: 'Subject trusts object as a validator / verifier.',
  },
  [RELATIONSHIP_TYPE.PARTNERSHIP]: {
    name: 'PARTNERSHIP',
    hierarchical: false,
    transitive: false,
    symmetric: true,
    description: 'Bilateral partnership / cross-recognition.',
  },
  [RELATIONSHIP_TYPE.OPERATES_ON_BEHALF_OF]: {
    name: 'OPERATES_ON_BEHALF_OF',
    hierarchical: false,
    transitive: false,
    symmetric: false,
    description: 'Subject operates on behalf of object (delegated operational authority marker).',
  },
  [RELATIONSHIP_TYPE.RECOMMENDS]: {
    name: 'RECOMMENDS',
    hierarchical: false,
    transitive: false,
    symmetric: false,
    description: 'Subject endorses / recommends object.',
  },
});
