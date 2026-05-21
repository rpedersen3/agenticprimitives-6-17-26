import { encodeAbiParameters, type Hex } from 'viem';
import { useReadContract } from 'wagmi';
import { thresholdValidatorAbi } from '@agenticprimitives/agent-account';
import { AuditTrailPreview, PendingApprovals, ThresholdMeter } from '../../components';
import { config } from '../../config';

const sampleProposalArgs = encodeAbiParameters(
  [{ type: 'uint256' }, { type: 'address' }],
  [5000000000000000n, '0x0000000000000000000000000000000000000001'],
) as Hex;

export function OrgTreasuryFlow() {
  const { data: defaultT3 } = useReadContract({
    address: config.thresholdValidator,
    abi: thresholdValidatorAbi,
    functionName: 'defaultThreshold',
    args: [3, 3],
    query: { enabled: !!config.thresholdValidator },
  });
  const { data: defaultT5 } = useReadContract({
    address: config.thresholdValidator,
    abi: thresholdValidatorAbi,
    functionName: 'defaultThreshold',
    args: [3, 5],
    query: { enabled: !!config.thresholdValidator },
  });

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">Use case 3</p>
        <h1>Org treasury approvals</h1>
        <p>
          Org mode turns treasury actions into readable proposals with tiered thresholds and visible
          separation of duties.
        </p>
      </div>
      <div className="grid">
        <section className="card">
          <h2>Default org policy</h2>
          <ul className="status-list">
            <li className="approved"><span>✓</span>T3 value actions require {String(defaultT3 ?? 2)} of 3 approvals</li>
            <li className="approved"><span>✓</span>T5 trust-root actions require {String(defaultT5 ?? 3)} of 3 approvals</li>
            <li className="pending"><span>○</span>T4 admin actions use timelock before execution</li>
          </ul>
        </section>
        <section className="card">
          <h2>Proposal draft</h2>
          <label className="field">
            <span>Action</span>
            <input readOnly value="Transfer 0.005 ETH to vendor wallet" />
          </label>
          <label className="field">
            <span>Encoded args</span>
            <textarea readOnly rows={3} value={sampleProposalArgs} />
          </label>
          <button disabled>Propose on ThresholdValidator (connect live account)</button>
        </section>
      </div>
      <PendingApprovals
        items={[
          { title: 'Vendor payout', meta: '0.005 ETH · T3 value action', status: '1 of 2', risk: 'T3 Value' },
          { title: 'Rotate paymaster', meta: 'Design-pending factory-level trust root', status: 'blocked', risk: 'T5 Critical' },
          { title: 'Add finance admin', meta: 'T4 admin · 1h timelock', status: 'ready to propose', risk: 'T4 Admin' },
        ]}
      />
      <ThresholdMeter
        approved={1}
        required={Number(defaultT3 ?? 2)}
        labels={[
          { label: 'Finance lead approved', status: 'approved' },
          { label: 'Operations admin pending', status: 'pending' },
        ]}
      />
      <AuditTrailPreview
        events={[
          { action: 'org.policy.loaded', detail: 'Default threshold matrix read from validator', correlation: 'mode:org' },
          { action: 'proposal.previewed', detail: 'Treasury proposal encoded for review', correlation: sampleProposalArgs.slice(0, 18) },
        ]}
      />
    </section>
  );
}
