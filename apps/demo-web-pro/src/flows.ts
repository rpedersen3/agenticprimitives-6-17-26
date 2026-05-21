export type FlowStatus = 'stub' | 'preview' | 'in-flight' | 'live';
export type FlowSlug =
  | 'hybrid-recovery'
  | 'threshold-approval'
  | 'org-treasury'
  | 'steward-attenuation'
  | 'recovery';

export interface FlowMeta {
  slug: FlowSlug;
  title: string;
  oneLiner: string;
  status: FlowStatus;
  availableNow: boolean;
  mode: 'single' | 'hybrid' | 'threshold' | 'org';
  risk: 'T1 Read' | 'T3 Value' | 'T4 Admin' | 'T6 Recovery';
  guidePath: string;
  steps: string[];
  requires?: string[];
}

export const FLOWS: FlowMeta[] = [
  {
    slug: 'hybrid-recovery',
    title: 'Individual user, seamless recovery',
    oneLiner: 'Deploy a hybrid AgentAccount from the factory with your connected wallet as owner and optional guardians.',
    status: 'live',
    availableNow: true,
    mode: 'hybrid',
    risk: 'T4 Admin',
    guidePath: 'docs/multi-sig/flows/hybrid-recovery.md',
    steps: ['Connect', 'Configure', 'Review', 'Deploy', 'Backup'],
  },
  {
    slug: 'threshold-approval',
    title: 'High-risk agent delegation',
    oneLiner: 'A future approval flow for value-moving agent sessions.',
    status: 'preview',
    availableNow: false,
    mode: 'threshold',
    risk: 'T3 Value',
    guidePath: 'docs/multi-sig/flows/threshold-approval.md',
    steps: ['Request', 'Approve', 'Bless on-chain', 'Ready'],
    requires: [
      'Session package hardening so invalid delegations are rejected before storage.',
      'On-chain accepted-session blessing wired into the account/session path.',
      'End-to-end quorum signature collection for T3 permissions.',
    ],
  },
  {
    slug: 'org-treasury',
    title: 'Org treasury',
    oneLiner: 'A future org policy screen for treasury proposals and approvals.',
    status: 'preview',
    availableNow: false,
    mode: 'org',
    risk: 'T3 Value',
    guidePath: 'docs/multi-sig/flows/org-treasury.md',
    steps: ['Setup org', 'Draft action', 'Collect approvals', 'Execute'],
    requires: [
      'Live org-mode account deployment with multiple owners.',
      'Validator proposal writes exposed through a supported client flow.',
      'Treasury/value-policy package or approved minimal treasury action model.',
    ],
  },
  {
    slug: 'steward-attenuation',
    title: 'Steward to delegate to agent',
    oneLiner: 'A future attenuation proof for parent -> steward -> agent delegations.',
    status: 'preview',
    availableNow: false,
    mode: 'threshold',
    risk: 'T1 Read',
    guidePath: 'docs/multi-sig/flows/steward-attenuation.md',
    steps: ['Parent grant', 'Steward grant', 'Subset check', 'Agent ready'],
    requires: [
      'H5 cross-delegation subset verifier.',
      'Runtime enforcement that child caveats cannot widen parent authority.',
      'Audit correlation across parent and child delegation chains.',
    ],
  },
  {
    slug: 'recovery',
    title: 'Lost device recovery',
    oneLiner: 'A future guardian recovery flow with quorum, timelock, and cancel window.',
    status: 'preview',
    availableNow: false,
    mode: 'hybrid',
    risk: 'T6 Recovery',
    guidePath: 'docs/multi-sig/flows/recovery.md',
    steps: ['Start recovery', 'Guardian quorum', 'Cancel window', 'Execute'],
    requires: [
      'Recovery execution UI wired to ThresholdValidator recovery actions.',
      'Guardian signature collection and display.',
      'Timelock/cancel-window reads from a live account.',
    ],
  },
];

export function flowBySlug(slug: string | undefined): FlowMeta | undefined {
  return FLOWS.find((flow) => flow.slug === slug);
}
