/**
 * Live/Simulated/Not-started badge. Per spec 211 § 9 "Live/simulated
 * honesty — non-negotiable": every act surfaces the boundary
 * explicitly.
 */

import type { ActStatus } from '../acts';

export function LiveStatusBadge({ status }: { status: ActStatus }) {
  if (status === 'live') {
    return (
      <span className="status-dot status-dot--live" aria-label="Live on Base Sepolia">
        <span className="dot" /> LIVE
      </span>
    );
  }
  if (status === 'simulated') {
    return (
      <span className="status-dot status-dot--sim" aria-label="Simulated — not yet on chain">
        <span className="dot" /> SIMULATED
      </span>
    );
  }
  return (
    <span className="status-dot status-dot--queued" aria-label="Not started yet">
      <span className="dot" /> QUEUED
    </span>
  );
}
