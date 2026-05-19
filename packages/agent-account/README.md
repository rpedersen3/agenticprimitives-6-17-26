# @agenticprimitives/agent-account

ERC-4337 smart-account substrate. Deterministic addressing via CREATE2 factory, lazy deployment, ERC-1271 signing, UserOp building. Account-agnostic of how the user signs — that's `@agenticprimitives/identity-auth`'s job.

See [`spec.md`](./spec.md) → [`specs/201-agent-account.md`](../../specs/201-agent-account.md).

## Install

```bash
pnpm add @agenticprimitives/agent-account
```

## Quick start

```ts
import { AgentAccountClient } from '@agenticprimitives/agent-account';
import { deriveSaltFromEmail } from '@agenticprimitives/identity-auth';

const account = new AgentAccountClient({
  rpcUrl: process.env.RPC_URL!,
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID),
  entryPoint: process.env.ENTRYPOINT_ADDRESS as `0x${string}`,
  factory: process.env.AGENT_FACTORY_ADDRESS as `0x${string}`,
});

const salt = deriveSaltFromEmail(user.email, 0);
const address = await account.getAddress(bootstrapSigner.address, salt);
// later, when user does something:
if (!(await account.isDeployed(address))) {
  await account.createAccount({ owner: bootstrapSigner.address, salt }, bootstrapSigner);
}
```

## Status

Pre-alpha. Spec stable.
