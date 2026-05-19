// @agenticprimitives/types — cross-cutting branded primitives. Types-only.

export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type ChainId = number & { readonly __chainId: unique symbol };
export type BrandedId<T extends string> = string & { readonly __brand: T };
