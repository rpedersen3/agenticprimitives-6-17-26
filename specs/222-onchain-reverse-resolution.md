# spec/222 — On-chain reverse resolution

**Status:** Proposed (2026-05-24).
**Doctrine:** [ADR-0012](../docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md).
**Related:** [ADR-0006](../docs/architecture/decisions/0006-agent-naming-as-resolution-layer.md), [spec/215](./215-agent-naming.md) (current naming spec), [ADR-0010](../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md) (canonical identifier).
**Replaces (read-side):** `AgentNamingClient._reconstructName` log-walk fallback (transitional per ADR-0012).

## 1. Problem statement

Our `AgentNameRegistry.setPrimaryName(bytes32 node)` stores only the
namehash node for the reverse record:

```solidity
mapping(address => bytes32) private _primaryName;

function setPrimaryName(bytes32 node) external {
    if (node != bytes32(0) && _records[node].registeredAt == 0) revert NodeNotFound();
    _primaryName[msg.sender] = node;
    emit PrimaryNameSet(msg.sender, node);
}

function primaryName(address agent) external view returns (bytes32) {
    return _primaryName[agent];
}
```

`AgentNameUniversalResolver.reverseResolve(agent)` then enforces the
round-trip and returns the **node** — never the human-readable string.

```solidity
function reverseResolve(address agent) external view returns (bytes32 node) {
    node = REGISTRY.primaryName(agent);
    if (node == bytes32(0)) return bytes32(0);
    if (!REGISTRY.recordExists(node)) return bytes32(0);
    address forward = _resolveNameView(node);
    if (forward != agent) return bytes32(0);
    return node;
}
```

To turn the node back into `alice.demo.agent` for display, the SDK
(`packages/agent-naming/src/client.ts`) walks `NameRegistered` event
logs up the parent chain:

```ts
private async _reconstructName(startNode: Hex): Promise<string | null> {
  // … walks NameRegistered events via eth_getLogs at each parent level
}
```

This puts an `eth_getLogs` call on the **default reverse-resolve hot
path** — violating [ADR-0012](../docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md)
and producing the exact failure modes the demo just shipped patches
for:

- Alchemy free tier caps `eth_getLogs` at 10 blocks/request → 400 errors.
- Alchemy rate-limits getLogs aggressively → 429 storms.
- Alchemy free tier rejects browser CORS → blocks the call entirely.

## 2. Why established on-chain name registries don't have this problem

Established on-chain reverse resolution does NOT depend on event walking. It stores the
**string** on the reverse resolver:

```solidity
// reverse-registrar + default-reverse-resolver pseudocode
ReverseRegistrar.setName(string newName)
  → resolver.setName(node, newName)
  → resolver.name(node) returns (string)   // single readContract call
```

The "display Alice's primary name" display path in those systems is:

```
node = namehash(addressToNode(agent))         // pure off-chain
name = readContract(resolver, 'name', [node]) // ONE chain call
verify forward(name) === agent                // ONE more chain call
```

No event scan. No `getLogs`. No rate-limit exposure.

Newer hierarchical registries keep the same shape: hierarchical registries for forward
records, separate reverse resolvers holding the **string** for
reverse. The forward / records side aligns with our universal
resolver; the reverse side is where we diverged.

## 3. Reference: smart-agent patterns to port

`smart-agent` does not yet ship a reverse resolver. The agent-naming
SDK was written before this divergence surfaced (stored-string reverse was
not yet a porting reference). This spec is the deliberate divergence
correction.

## 4. Design — store the label string on chain

Two viable approaches; this spec proposes **B** as the canonical
fix, with **A** documented as a fallback if the resolver redesign
is deferred.

### Option A — label-per-node string attribute (incremental)

Add a `displayLabel: string` attribute (predicate `atl:label`) on
each node. `subregistry.register` and `registry.register` set the
attribute at registration time. The SDK walks `parent(node)` via
view calls and reads `getString(node, ATL_LABEL)` at each level —
NO event scans, all view calls.

```solidity
// In AgentNameAttributeResolver.sol
bytes32 constant ATL_LABEL = keccak256("atl:label");
// existing AttributeStorage already handles per-node string storage
```

```ts
// SDK
async _reconstructNameViaViewCalls(startNode: Hex): Promise<string | null> {
  const labels: string[] = [];
  let cur = startNode;
  for (let depth = 0; depth < 10; depth++) {
    if (cur === ZERO_NODE) break;
    const label = await resolver.getString(cur, ATL_LABEL);
    if (!label) return null;
    labels.push(label);
    cur = await registry.parent(cur);
  }
  return labels.join('.');
}
```

**Cost:** one storage write per level at registration (already done
for `displayName` etc.); one view call per level on read (typically
1-3 calls for `alice.demo.agent`).

**Pros:** minimal contract surface change; reuses AttributeStorage;
hierarchical naming continues to work; safe to add to existing
deployments by setting the new attribute on register.

**Cons:** still N round trips on reverse (vs 1 for a full stored-string resolver).
Acceptable — N is small.

### Option B — separate ReverseResolver holding the full string

Mirror the established stored-string pattern exactly: introduce a `ReverseResolver` contract that
stores `mapping(address => string) _primaryNameString`. The agent
calls `reverseResolver.setName(string)` (or a combined
`registry.setPrimaryName(bytes32 node, string name)`); the
contract MUST verify `namehash(name) == node` to prevent
mislabelling.

```solidity
contract AgentNameReverseResolver {
    AgentNameRegistry public immutable REGISTRY;
    mapping(address => string) private _nameOf;
    event PrimaryNameStringSet(address indexed agent, string name);

    function setName(string calldata name) external {
        bytes32 node = _namehash(name);
        // Must match the registry's primary-name node + round-trip.
        require(REGISTRY.primaryName(msg.sender) == node, "node mismatch");
        require(_forwardResolves(node, msg.sender), "forward mismatch");
        _nameOf[msg.sender] = name;
        emit PrimaryNameStringSet(msg.sender, name);
    }

    function name(address agent) external view returns (string memory) {
        return _nameOf[agent];
    }
}
```

UniversalResolver's `reverseResolve(agent)` returns a `(string name,
bytes32 node)` pair OR a new `reverseResolveString(address)` view
returns just the string.

**Pros:** single readContract for reverse — matches the established stored-string UX exactly.
**Cons:** two writes during registration ceremony (setPrimaryName +
reverseResolver.setName) OR a combined call; new contract to
deploy + audit.

## 5. Recommended path: Option A, then B

1. **Phase 1 (Option A — incremental):** add `ATL_LABEL` predicate,
   set it during register, switch SDK to view-call reconstruction.
   Single PR; redeploy attribute resolver only.
2. **Phase 2 (Option B — full alignment):** add ReverseResolver +
   single-call reverse. Migrate UniversalResolver. Run a one-time
   indexer script to backfill `name` for existing primaries.

Phase 1 alone removes the `eth_getLogs` dependency entirely from the
read path and unblocks the demo's free-tier RPC. Phase 2 brings UX
parity with established on-chain name registries for ecosystem familiarity.

## 6. Migration

- **Existing primaries**: nodes already registered before this spec
  lands have no `ATL_LABEL` set. Backfill in the same tx that adds
  the predicate to the deploy script, OR ship a one-shot
  `scripts/backfill-labels.ts` that iterates existing nodes (via
  `getChildren` from the universal resolver — bounded) and writes
  the missing labels.
- **SDK rollout**: agent-naming SDK ships the new view-call path
  behind a feature flag (`opts.useViewCallReconstruction?: boolean`)
  for one release; flip default-on next. Log-walk fallback can stay
  for one more release as a safety net.
- **App rollout**: demo-web-pro switches to the new SDK + drops the
  local name-cache as the source of display truth (cache stays as
  an optimization, not a workaround).

## 7. UX validation

The user-facing surfaces that benefit immediately:

| Surface | Before | After (Option A) |
| --- | --- | --- |
| `NameDisplay` everywhere | local cache OR truncated address | view-call reverse → name string, ~200ms first time, cached after |
| `AgentDetailModal` "Primary name" row | local cache | one chain call returns string |
| External agents (peers we didn't create) | truncated address | view-call reverse → name string |

## 8. Doctrine & follow-ups

- Update [ADR-0012](../docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md):
  remove the `agent-naming._reconstructName` carve-out once Option A
  ships.
- Update [`packages/agent-naming/CLAUDE.md`](../packages/agent-naming/CLAUDE.md):
  drop the "Drift triggers — STOP" entry permitting `getLogs` for
  reverse; reverse becomes view-call-only.
- Audit other readContract-only paths to ensure none have similar
  hidden dependencies on events.
- Consider a tiny indexer Worker as a backstop for non-primary
  lookups (e.g., "list all names this agent owns") — same indexer
  could also serve the off-chain audit feed (spec/206).

## 9. Open questions

- **Q1.** Should the label string include the suffix (`alice7.demo.agent`)
  or just the leaf label (`alice7`)? Argument for full: easier display.
  Argument for leaf: matches per-node storage cleanly; SDK joins from
  parents.
- **Q2.** Permissionless subregistry: who writes the label? Likely the
  subregistry itself during `register()`. Same trust boundary as the
  current `register` call.
- **Q3.** Multi-name agents: an agent can own multiple names but only
  one primary. Do we store the label per node (Option A — yes) or per
  agent (Option B — only for primary)?

## 10. Out of scope

- A general-purpose indexer service. That's its own spec.
- Backfilling labels for stranded names from prior demo runs (low
  value; let them stay unresolvable in the demo UI).
- Cross-chain reverse resolution (multi-chain CAIP-10 → name) —
  separate work, depends on ADR-0008.
