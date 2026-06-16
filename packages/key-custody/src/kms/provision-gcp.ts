// GCP Cloud KMS provisioning helper (spec 276 KCS-D3). Ports smart-agent's
// G-PR-6 operator runbook into a reusable, peer-dependency-free primitive.
//
// PURE PLANNING + INJECTED EXECUTION: `planGcpProvision` emits the gcloud steps;
// `executeGcpProvision` runs them through a caller-supplied `StepExecutor` (a
// gcloud runner, a REST runner, or a test fake). The package never shells out
// itself — that keeps it Workers-safe and unit-testable. The CLI (`bin/ap-provision-gcp.mjs`)
// supplies a Node child_process executor.
//
// No vertical identity names are baked in — `identities` are opaque labels the
// caller supplies (ADR-0021). Per-key (not per-keyring) IAM enforces master-key
// separation (key-custody CLAUDE.md invariant).

import { addressFromSpkiPem, type Hex } from './secp256k1-core.js';

export interface ProvisionPlan {
  project: string;
  location: string;
  keyRing: string;
  /** Opaque signing-identity labels → one HSM secp256k1 key each. NO vertical names here. */
  identities: string[];
  /** Service-account email to grant `roles/cloudkms.signer`, scoped per key. */
  runtimeServiceAccount: string;
  /** secp256k1 in GCP requires HSM; SOFTWARE is rejected by GCP for this curve. Default HSM. */
  protectionLevel?: 'HSM' | 'SOFTWARE';
}

export type StepKind = 'create-keyring' | 'create-key' | 'grant-iam';

export interface GcloudStep {
  id: string;
  kind: StepKind;
  description: string;
  /** argv for `gcloud` (no shell string — avoids injection). */
  argv: string[];
  /** Present for create-key / grant-iam steps. */
  identity?: string;
  /** The key resource this step targets (create-key / grant-iam). */
  cryptoKeyName?: string;
}

export interface StepExecutor {
  /** Run a planned step. Return `{ alreadyExists: true }` to mark an idempotent skip
   *  (the resource already existed); throw for any real failure. */
  run(step: GcloudStep): Promise<{ stdout: string; alreadyExists?: boolean }>;
  /** Fetch a key version's SPKI PEM (for address verification) — via gcloud or REST. */
  getPublicKeyPem(cryptoKeyVersionName: string): Promise<string>;
}

export interface ProvisionResult {
  /** identity → full `…/cryptoKeyVersions/1` resource name. */
  keyMap: Record<string, string>;
  /** identity → derived EVM address (verify against expectations BEFORE wiring env). */
  addresses: Record<string, Hex>;
  granted: Array<{ key: string; member: string; role: 'roles/cloudkms.signer' }>;
  /** Step ids that were skipped because the resource already existed (idempotent re-run). */
  alreadyExisted: string[];
}

function keyResourceName(plan: ProvisionPlan, identity: string): string {
  return `projects/${plan.project}/locations/${plan.location}/keyRings/${plan.keyRing}/cryptoKeys/${identity}`;
}

/** First key version GCP creates for an asymmetric-signing key. */
export function keyVersionName(plan: ProvisionPlan, identity: string): string {
  return `${keyResourceName(plan, identity)}/cryptoKeyVersions/1`;
}

/** Emit the ordered gcloud steps for a provisioning plan. Pure — no execution. */
export function planGcpProvision(plan: ProvisionPlan): GcloudStep[] {
  if (!plan.project || !plan.location || !plan.keyRing) {
    throw new Error('planGcpProvision: project, location, and keyRing are required');
  }
  if (!plan.runtimeServiceAccount.includes('@')) {
    throw new Error('planGcpProvision: runtimeServiceAccount must be a service-account email');
  }
  if (plan.identities.length === 0) throw new Error('planGcpProvision: at least one identity is required');
  const dupes = plan.identities.filter((id, i) => plan.identities.indexOf(id) !== i);
  if (dupes.length) throw new Error(`planGcpProvision: duplicate identities: ${[...new Set(dupes)].join(', ')}`);
  const protection = (plan.protectionLevel ?? 'HSM').toLowerCase();

  const steps: GcloudStep[] = [
    {
      id: 'keyring',
      kind: 'create-keyring',
      description: `Create key ring ${plan.keyRing} in ${plan.location}`,
      argv: ['kms', 'keyrings', 'create', plan.keyRing, '--location', plan.location, '--project', plan.project],
    },
  ];

  for (const identity of plan.identities) {
    if (!/^[a-zA-Z0-9_-]+$/.test(identity)) {
      throw new Error(`planGcpProvision: identity "${identity}" must match [a-zA-Z0-9_-]+ (a GCP key id)`);
    }
    const cryptoKeyName = keyResourceName(plan, identity);
    steps.push({
      id: `key:${identity}`,
      kind: 'create-key',
      identity,
      cryptoKeyName,
      description: `Create HSM secp256k1 signing key ${identity}`,
      argv: [
        'kms', 'keys', 'create', identity,
        '--keyring', plan.keyRing,
        '--location', plan.location,
        '--project', plan.project,
        '--purpose', 'asymmetric-signing',
        '--default-algorithm', 'ec-sign-secp256k1-sha256',
        '--protection-level', protection,
      ],
    });
    steps.push({
      id: `iam:${identity}`,
      kind: 'grant-iam',
      identity,
      cryptoKeyName,
      description: `Grant roles/cloudkms.signer on ${identity} to ${plan.runtimeServiceAccount}`,
      argv: [
        'kms', 'keys', 'add-iam-policy-binding', identity,
        '--keyring', plan.keyRing,
        '--location', plan.location,
        '--project', plan.project,
        '--member', `serviceAccount:${plan.runtimeServiceAccount}`,
        '--role', 'roles/cloudkms.signer',
      ],
    });
  }
  return steps;
}

/** Execute a provisioning plan through an injected executor. Idempotent: steps whose
 *  resource already exists are skipped and reported. After create+grant, fetches each
 *  key's public key and derives its EVM address so the operator can verify before wiring. */
export async function executeGcpProvision(plan: ProvisionPlan, exec: StepExecutor): Promise<ProvisionResult> {
  const steps = planGcpProvision(plan);
  const alreadyExisted: string[] = [];
  const granted: ProvisionResult['granted'] = [];

  for (const step of steps) {
    const r = await exec.run(step);
    if (r.alreadyExists) alreadyExisted.push(step.id);
    if (step.kind === 'grant-iam' && step.cryptoKeyName) {
      granted.push({ key: step.cryptoKeyName, member: `serviceAccount:${plan.runtimeServiceAccount}`, role: 'roles/cloudkms.signer' });
    }
  }

  const keyMap: Record<string, string> = {};
  const addresses: Record<string, Hex> = {};
  for (const identity of plan.identities) {
    const versionName = keyVersionName(plan, identity);
    keyMap[identity] = versionName;
    const pem = await exec.getPublicKeyPem(versionName);
    addresses[identity] = addressFromSpkiPem(pem);
  }

  return { keyMap, addresses, granted, alreadyExisted };
}
