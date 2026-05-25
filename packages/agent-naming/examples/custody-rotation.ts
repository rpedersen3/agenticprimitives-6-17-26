import { namehash } from '@agenticprimitives/agent-naming';
import {
  buildRecordCalls,
  buildRotateNameOwnerCall,
  buildRotateNameResolverCall,
  buildSetPrimaryNameCall,
} from '@agenticprimitives/agent-naming/custody';

const registry = '0x0000000000000000000000000000000000000001';
const resolver = '0x0000000000000000000000000000000000000002';
const newOwner = '0x0000000000000000000000000000000000000003';
const node = namehash('treasury.acme.agent');

// These are pure encoded calls. Submit them through your own transaction path:
// a Smart Agent execute call, a relayer, or an account-safety approval flow.
const rotateOwner = buildRotateNameOwnerCall({
  registry,
  node,
  newOwner,
});

const rotateResolver = buildRotateNameResolverCall({
  registry,
  node,
  newResolver: resolver,
});

const setPrimaryName = buildSetPrimaryNameCall({
  registry,
  node,
});

const recordCalls = buildRecordCalls({
  resolver,
  node,
  records: {
    addr: newOwner,
    agentKind: 'service', // treasury is a service subtype (profile), not an agent kind
    displayName: 'Acme Treasury',
    nativeId: `eip155:84532:${newOwner}`,
  },
});

console.log([rotateOwner, rotateResolver, setPrimaryName, ...recordCalls]);
