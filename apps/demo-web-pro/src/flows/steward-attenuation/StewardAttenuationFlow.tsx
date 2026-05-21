import { AuditTrailPreview, PermissionCard, ThresholdMeter } from '../../components';

export function StewardAttenuationFlow() {
  return (
    <section>
      <div className="hero">
        <p className="eyebrow">Use case 4</p>
        <h1>Steward attenuation</h1>
        <p>
          A parent account delegates to a steward, then the steward delegates a narrower permission
          to an agent. The UI makes widening impossible to miss.
        </p>
      </div>
      <div className="split">
        <section className="card">
          <h2>Authority chain</h2>
          <ul className="status-list">
            <li className="approved"><span>✓</span>Parent: may read invoices and draft payments</li>
            <li className="approved"><span>✓</span>Steward: may review invoices under $1,000</li>
            <li className="pending"><span>○</span>Agent: may summarize invoices only</li>
          </ul>
        </section>
        <PermissionCard
          title="Let invoice-agent summarize low-value invoices"
          agent="invoice-agent.mcp.local"
          risk="T1 Read"
          allowed={[
            'Read invoice metadata from the MCP resource server.',
            'Return summaries to the steward session.',
          ]}
          limits={[
            'Child caveats must be a subset of the steward caveats.',
            'No value transfer and no write tools.',
          ]}
          denied={[
            'Cannot draft payments even though the parent can.',
            'Cannot increase invoice limits.',
          ]}
          technical={<pre>{JSON.stringify({ status: 'preview', blocker: 'H5 cross-delegation subset verification' }, null, 2)}</pre>}
        />
      </div>
      <ThresholdMeter
        approved={2}
        required={2}
        labels={[
          { label: 'Parent delegation scope known', status: 'approved' },
          { label: 'Child request is narrower in UI preview', status: 'approved' },
          { label: 'Runtime subset verifier pending', status: 'blocked' },
        ]}
      />
      <AuditTrailPreview
        events={[
          { action: 'attenuation.previewed', detail: 'Parent/steward/agent chain displayed', correlation: 'chain:invoice' },
          { action: 'subset.blocked', detail: 'Live enforcement waits for H5 verifier', correlation: 'blocker:H5' },
        ]}
      />
    </section>
  );
}
