# @agenticprimitives/types

Cross-cutting branded types and chain primitives shared across `@agenticprimitives/*` packages. Types-only; no runtime code.

## Install

```bash
pnpm add @agenticprimitives/types
```

## Exports

```ts
import type { Address, Hex, ChainId, BrandedId } from '@agenticprimitives/types';

type SessionId = BrandedId<'SessionId'>;
const chain: ChainId = 1 as ChainId;
const account: Address = '0x...';
```

## Status

Alpha track — testnet-only. Minimal by design (adding a type here requires ≥2 consuming packages). Do not deploy to production until the gates listed in the root [`README.md` Status section](../../README.md#status) are cleared.
