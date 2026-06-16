// spec 276 KCS-D3/D4 — GCP provisioning planner/executor + key-map parsing.
import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
  planGcpProvision,
  executeGcpProvision,
  keyVersionName,
  type GcloudStep,
  type StepExecutor,
} from '../../src/kms/provision-gcp.js';
import { parseServiceAccountJson, parseSignerKeyMap, isCryptoKeyVersionName } from '../../src/kms/key-map.js';
import { publicKeyToAddress } from '../../src/kms/secp256k1-core.js';

const PLAN = {
  project: 'demo-proj',
  location: 'us-east1',
  keyRing: 'demo-ring',
  identities: ['signer-a', 'signer-b'],
  runtimeServiceAccount: 'runtime@demo-proj.iam.gserviceaccount.com',
} as const;

function spkiPemFor(pub65: Uint8Array): string {
  const prefix = Uint8Array.from([
    0x30, 0x56, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b,
    0x81, 0x04, 0x00, 0x0a, 0x03, 0x42, 0x00,
  ]);
  const der = new Uint8Array(prefix.length + pub65.length);
  der.set(prefix, 0);
  der.set(pub65, prefix.length);
  let b64 = '';
  for (let i = 0; i < der.length; i++) b64 += String.fromCharCode(der[i]!);
  return `-----BEGIN PUBLIC KEY-----\n${btoa(b64).replace(/(.{64})/g, '$1\n')}\n-----END PUBLIC KEY-----\n`;
}

describe('planGcpProvision', () => {
  it('emits keyring + per-identity create-key + per-key grant-iam (per-key IAM, not per-keyring)', () => {
    const steps = planGcpProvision(PLAN);
    expect(steps[0]!.kind).toBe('create-keyring');
    const creates = steps.filter((s) => s.kind === 'create-key');
    const grants = steps.filter((s) => s.kind === 'grant-iam');
    expect(creates.map((s) => s.identity)).toEqual(['signer-a', 'signer-b']);
    expect(grants.map((s) => s.identity)).toEqual(['signer-a', 'signer-b']);
    // secp256k1 + HSM by default
    expect(creates[0]!.argv).toContain('ec-sign-secp256k1-sha256');
    expect(creates[0]!.argv).toContain('asymmetric-signing');
    expect(creates[0]!.argv.join(' ').toLowerCase()).toContain('--protection-level hsm');
    // per-key signer binding
    expect(grants[0]!.argv).toContain('roles/cloudkms.signer');
    expect(grants[0]!.argv).toContain('add-iam-policy-binding');
  });

  it('rejects bad input', () => {
    expect(() => planGcpProvision({ ...PLAN, identities: [] })).toThrow(/at least one identity/);
    expect(() => planGcpProvision({ ...PLAN, identities: ['a', 'a'] })).toThrow(/duplicate/);
    expect(() => planGcpProvision({ ...PLAN, runtimeServiceAccount: 'not-an-email' })).toThrow(/service-account email/);
    expect(() => planGcpProvision({ ...PLAN, identities: ['bad/id'] })).toThrow(/\[a-zA-Z0-9_-\]/);
  });
});

describe('executeGcpProvision', () => {
  it('runs all steps, derives addresses, reports idempotent skips', async () => {
    const priv = secp256k1.utils.randomSecretKey();
    const pub65 = secp256k1.getPublicKey(priv, false);
    const expectedAddr = publicKeyToAddress(pub65);

    const ran: string[] = [];
    const exec: StepExecutor = {
      async run(step: GcloudStep) {
        ran.push(step.id);
        // pretend the keyring already exists (idempotent path)
        if (step.kind === 'create-keyring') return { stdout: '', alreadyExists: true };
        return { stdout: 'ok' };
      },
      async getPublicKeyPem() {
        return spkiPemFor(pub65);
      },
    };

    const result = await executeGcpProvision(PLAN, exec);
    expect(ran).toEqual(['keyring', 'key:signer-a', 'iam:signer-a', 'key:signer-b', 'iam:signer-b']);
    expect(result.alreadyExisted).toEqual(['keyring']);
    expect(result.keyMap['signer-a']).toBe(keyVersionName(PLAN, 'signer-a'));
    expect(result.addresses['signer-a']!.toLowerCase()).toBe(expectedAddr.toLowerCase());
    expect(result.granted).toHaveLength(2);
    expect(result.granted[0]!.role).toBe('roles/cloudkms.signer');
  });
});

describe('key-map parsing', () => {
  // private_key is opaque to the parser (it only checks it's a string), so use a benign
  // placeholder — a literal PEM here trips the gitleaks `private-key` rule (false positive).
  const sa = { client_email: 'x@y.iam.gserviceaccount.com', private_key: 'pk-test-fixture-placeholder', project_id: 'p' };

  it('parseServiceAccountJson accepts raw JSON, base64 JSON, and objects; fails closed otherwise', () => {
    expect(parseServiceAccountJson(JSON.stringify(sa)).client_email).toBe(sa.client_email);
    expect(parseServiceAccountJson(btoa(JSON.stringify(sa))).private_key).toBe(sa.private_key);
    expect(parseServiceAccountJson(sa).project_id).toBe('p');
    expect(() => parseServiceAccountJson('{}')).toThrow(/client_email or private_key/);
    expect(() => parseServiceAccountJson('not json !!')).toThrow(/not valid JSON/);
  });

  it('parseSignerKeyMap requires full key VERSION names and rejects bare key names / empty', () => {
    const good = { a: 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1' };
    expect(parseSignerKeyMap(good).a).toBe(good.a);
    expect(parseSignerKeyMap(btoa(JSON.stringify(good))).a).toBe(good.a);
    // bare key name (no /cryptoKeyVersions/N) is the classic mistake → reject
    expect(() => parseSignerKeyMap({ a: 'projects/p/locations/l/keyRings/r/cryptoKeys/k' })).toThrow(/cryptoKeyVersions/);
    expect(() => parseSignerKeyMap({})).toThrow(/empty map/);
    expect(() => parseSignerKeyMap([] as unknown as object)).toThrow(/object map/);
  });

  it('isCryptoKeyVersionName', () => {
    expect(isCryptoKeyVersionName('projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/3')).toBe(true);
    expect(isCryptoKeyVersionName('projects/p/locations/l/keyRings/r/cryptoKeys/k')).toBe(false);
  });
});
