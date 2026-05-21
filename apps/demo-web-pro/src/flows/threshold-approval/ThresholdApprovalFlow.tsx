import { encodeAbiParameters, keccak256, toBytes } from 'viem';
import { useReadContract } from 'wagmi';
import { thresholdValidatorAbi } from '@agenticprimitives/agent-account';
import { AuditTrailPreview, PermissionCard, ThresholdMeter } from '../../components';
import { config } from '../../config';

export function ThresholdApprovalFlow() {
  const { data: defaultT3 } = useReadContract({
    address: config.thresholdValidator,
    abi: thresholdValidatorAbi,
    functionName: 'defaultThreshold',
    args: [3, 3],
    query: { enabled: !!config.thresholdValidator },
  });

  const delegationHash = keccak256(
    encodeAbiParameters(
      [{ type: 'string' }, { type: 'uint256' }, { type: 'string' }],
      ['agenticprimitives.demo.highRiskDelegation', 2500000000000000n, 'read+limited-write'],
    ),
  );
  const required = Number(defaultT3 ?? 2);

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">Use case 2</p>
        <h1>High-risk agent delegation</h1>
        <p>
          Users approve what the agent can do before any value-moving session becomes usable.
          On-chain blessing uses `acceptSessionDelegation`; backend session packaging remains outside
          this screen.
        </p>
      </div>
      <div className="split">
        <PermissionCard
          title="Let research-agent rebalance a small treasury slice"
          agent="research-agent.a2a.local"
          risk="T3 Value"
          allowed={[
            'Call approved MCP tools for portfolio reads.',
            'Submit one rebalance transaction up to 0.0025 ETH equivalent.',
            'Use the permission for 60 minutes.',
          ]}
          limits={[
            'Requires threshold approval before on-chain blessing.',
            'Revocable by removing the accepted session hash.',
            'Bound to this agent and caveat set.',
          ]}
          denied={[
            'Cannot rotate owners, guardians, paymaster, or session issuer.',
            'Cannot widen spend limits or extend its own lifetime.',
          ]}
          technical={
            <pre>{JSON.stringify({ delegationHash, caveatBytes: toBytes('demo').length, validator: config.thresholdValidator ?? 'not configured' }, null, 2)}</pre>
          }
        />
        <ThresholdMeter
          approved={1}
          required={required}
          labels={[
            { label: 'Primary owner approved in wallet', status: 'approved' },
            { label: 'Second owner or guardian approval needed', status: 'pending' },
            { label: 'acceptSessionDelegation write blocked until quorum', status: 'blocked' },
          ]}
        />
      </div>
      <AuditTrailPreview
        events={[
          { action: 'permission.reviewed', detail: 'High-risk permission card rendered', correlation: delegationHash.slice(0, 18) },
          { action: 'threshold.pending', detail: `${required} approvals required for T3`, correlation: 'tier:T3' },
        ]}
      />
      <p className="muted">
        Status: preview. The permission card and threshold math are live; final write is held until
        the session package path rejects invalid delegations and exposes the blessing transaction.
      </p>
    </section>
  );
}
