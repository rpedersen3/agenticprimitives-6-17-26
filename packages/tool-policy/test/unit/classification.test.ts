import { describe, it, expect } from 'vitest';
import { declareTool } from '../../src/classification';

describe('declareTool', () => {
  it('attaches _classification to an object', () => {
    const tool = declareTool(
      { name: 'get_profile', handler: () => 'ok' },
      { '@sa-tool': 'delegation-verified', '@sa-auth': 'session-token' },
    );
    expect(tool._classification['@sa-tool']).toBe('delegation-verified');
    expect(tool._classification['@sa-auth']).toBe('session-token');
    expect(tool.name).toBe('get_profile');
  });

  it('returns the same object reference (mutating attach)', () => {
    const def = { name: 't' };
    const decorated = declareTool(def, { '@sa-tool': 'service-only', '@sa-auth': 'none' });
    expect(decorated).toBe(def);
  });
});
