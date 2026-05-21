import { AuditTrailPreview, PendingApprovals, ThresholdMeter } from '../../components';

export function RecoveryFlow() {
  return (
    <section>
      <div className="hero">
        <p className="eyebrow">Use case 5</p>
        <h1>Lost device recovery</h1>
        <p>
          Recovery stays understandable: guardian quorum starts the process, the primary owner gets
          a cancellation window, and execution waits for the timelock.
        </p>
      </div>
      <div className="grid">
        <section className="card">
          <h2>Recovery timeline</h2>
          <ul className="status-list">
            <li className="approved"><span>✓</span>Guardian quorum: 2 of 3</li>
            <li className="pending"><span>○</span>Primary-owner cancel window: first 24h</li>
            <li className="pending"><span>○</span>Total recovery timelock: 48h</li>
            <li className="blocked"><span>!</span>Execution disabled in demo preview</li>
          </ul>
        </section>
        <section className="card">
          <h2>What changes</h2>
          <p>
            Recovery can rotate owner keys and add a new passkey. It cannot silently change
            delegation manager, paymaster, or session issuer.
          </p>
          <button className="danger" disabled>Start recovery proposal (preview)</button>
        </section>
      </div>
      <ThresholdMeter
        approved={2}
        required={2}
        labels={[
          { label: 'Guardian Alice approved', status: 'approved' },
          { label: 'Guardian Ben approved', status: 'approved' },
          { label: 'Primary owner can cancel during first 24h', status: 'pending' },
        ]}
      />
      <PendingApprovals
        items={[
          { title: 'Replace lost phone passkey', meta: 'T6 recovery · eta 48h', status: 'cancel window', risk: 'T6 Recovery' },
          { title: 'Remove compromised guardian', meta: 'T4 admin · 1h timelock', status: 'not started', risk: 'T4 Admin' },
        ]}
      />
      <AuditTrailPreview
        events={[
          { action: 'recovery.proposed', detail: 'Guardian quorum reached', correlation: 'recovery:demo' },
          { action: 'recovery.timelocked', detail: '48h execution delay active', correlation: 'eta:+48h' },
        ]}
      />
    </section>
  );
}
