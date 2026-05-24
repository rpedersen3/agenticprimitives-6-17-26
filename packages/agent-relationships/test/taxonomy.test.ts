import { describe, expect, it } from 'vitest';
import {
  RELATIONSHIP_TYPE,
  ROLE,
  hashRelationshipType,
  hashRole,
  TYPE_SEMANTICS,
} from '../src/taxonomy';

describe('relationship type constants', () => {
  it('values are keccak256(name) (golden vectors)', () => {
    // keccak256("HAS_MEMBER") computed via viem at module load.
    expect(RELATIONSHIP_TYPE.HAS_MEMBER).toBe(hashRelationshipType('HAS_MEMBER'));
    expect(RELATIONSHIP_TYPE.HAS_GOVERNANCE_OVER).toBe(hashRelationshipType('HAS_GOVERNANCE_OVER'));
    expect(RELATIONSHIP_TYPE.VALIDATION_TRUST).toBe(hashRelationshipType('VALIDATION_TRUST'));
    expect(RELATIONSHIP_TYPE.PARTNERSHIP).toBe(hashRelationshipType('PARTNERSHIP'));
    expect(RELATIONSHIP_TYPE.OPERATES_ON_BEHALF_OF).toBe(hashRelationshipType('OPERATES_ON_BEHALF_OF'));
    expect(RELATIONSHIP_TYPE.RECOMMENDS).toBe(hashRelationshipType('RECOMMENDS'));
  });

  it('all relationship-type constants are 32-byte hex', () => {
    for (const value of Object.values(RELATIONSHIP_TYPE)) {
      expect(value).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it('intentionally does NOT include NAMESPACE_CONTAINS (ADR-0006: naming hierarchy is parent-pointer, not edge)', () => {
    expect(Object.keys(RELATIONSHIP_TYPE)).not.toContain('NAMESPACE_CONTAINS');
  });
});

describe('role constants', () => {
  it('values are keccak256(name) (golden vectors)', () => {
    expect(ROLE.MEMBER).toBe(hashRole('MEMBER'));
    expect(ROLE.BOARD_MEMBER).toBe(hashRole('BOARD_MEMBER'));
    expect(ROLE.OPERATOR).toBe(hashRole('OPERATOR'));
    expect(ROLE.VALIDATOR).toBe(hashRole('VALIDATOR'));
    expect(ROLE.TREASURER).toBe(hashRole('TREASURER'));
    expect(ROLE.RECOVERY_CONTACT).toBe(hashRole('RECOVERY_CONTACT'));
  });

  it('all role constants are 32-byte hex', () => {
    for (const value of Object.values(ROLE)) {
      expect(value).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});

describe('TYPE_SEMANTICS', () => {
  it('has an entry for every well-known relationship type', () => {
    for (const value of Object.values(RELATIONSHIP_TYPE)) {
      expect(TYPE_SEMANTICS[value]).toBeDefined();
    }
  });

  it('marks PARTNERSHIP as symmetric and HAS_GOVERNANCE_OVER as hierarchical', () => {
    expect(TYPE_SEMANTICS[RELATIONSHIP_TYPE.PARTNERSHIP]!.symmetric).toBe(true);
    expect(TYPE_SEMANTICS[RELATIONSHIP_TYPE.HAS_GOVERNANCE_OVER]!.hierarchical).toBe(true);
    expect(TYPE_SEMANTICS[RELATIONSHIP_TYPE.HAS_MEMBER]!.symmetric).toBe(false);
  });

  it('semantics map is frozen', () => {
    expect(Object.isFrozen(TYPE_SEMANTICS)).toBe(true);
  });
});
