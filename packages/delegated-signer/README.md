# @agenticprimitives/delegated-signer

Generic **named delegated-signer resolution** (spec 276). Compose the trust primitives into one
answer: _"give me a signer for the named identity X, authorized by delegation chain Y."_

```ts
import { resolveDelegatedSigner } from '@agenticprimitives/delegated-signer';

const resolved = await resolveDelegatedSigner({
  name: 'acme',                       // opaque label — resolved by your injected client
  signer: kmsBackend,                 // a KmsAccountBackend from @agenticprimitives/key-custody
  delegationChain: [root, leaf],      // Delegation[] from @agenticprimitives/delegation
  resolveName: async (n) => nameClient.resolve(n),     // agent-naming (injected)
  verifyAccount: async (sa) => accountClient.isValid(sa), // agent-account (injected)
  chainId: 8453,
  delegationManager: '0x…',
});

const sig = await resolved.sign(digest); // 0x-hex (r,s,v) signature by resolved.signerAddress
```

It verifies the name resolves, the account is valid, and the delegation chain is rooted at the named
Smart Agent, link-by-link authority-bound, and terminates at the signer key — fail-closed throughout
(ADR-0013). Naming and account access are **injected** so the package stays vertical-agnostic and a
pure leaf in the dependency graph (ADR-0021). On-chain ERC-1271 signature verification of each link is
`delegation.verifyAuthorization`'s job; inject it upstream if you need it.
