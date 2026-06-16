// @agenticprimitives/key-custody/kms-core — the consumer-safe KMS signing surface (spec 276).
//
// Import this (NOT the package barrel) when you only need to sign a digest with
// a Cloud KMS secp256k1 key. Its transitive deps are ONLY `@noble/curves` +
// `@noble/hashes` — no `viem`, no `@agenticprimitives/audit`/`connect-auth`
// peers. This exists so apps never inline the KMS signer again (the
// demo-validator `kms-signer.ts` problem; ADR-0013 — one primitive, not copies).
//
// The audited, viem-typed `GcpKmsSigner` (the package barrel) is a thin wrapper
// over exactly this code.

export {
  type Hex,
  bytesToHex,
  base64UrlEncode,
  base64Decode,
  base64Encode,
  pemToDer,
  bigIntTo32Bytes,
  parseDerEcdsa,
  parseDerEcdsaSignature,
  normalizeLowS,
  toLowS,
  parseSpkiUncompressedSecp256k1PubKey,
  publicKeyToAddress,
  addressFromSpkiPem,
  findRecoveryByte,
  recoverV,
  assembleEthSignature,
  signDigestWithKms,
} from './secp256k1-core.js';

export {
  type ServiceAccount,
  type CachedToken,
  type GcpKmsTransport,
  signJwt,
  fetchAccessToken,
  callKms,
  createGcpKmsTransport,
  gcpSignDigest,
} from './gcp-transport.js';

export {
  type SignerKeyMap,
  parseServiceAccountJson,
  parseSignerKeyMap,
  isCryptoKeyVersionName,
} from './key-map.js';
