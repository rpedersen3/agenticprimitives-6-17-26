// Agreement (Connection) lifecycle + provenance (spec 250 §15). The Agreement is the
// primary audit object: who agreed to serve whom, for which need, on which skill, when,
// and how it ended. Every transition is a provenance-bearing event.

import type { AgentId, ISODateTime, Uri } from './gs-types';

/** The 9-state connection lifecycle (spec 250 §15.1). */
export type GsConnectionStatus =
  | 'proposed' // a match exists, no request sent
  | 'requested' // GCO requested a connection
  | 'confirmed' // KC accepted; Agreement created
  | 'ongoing' // relationship is active
  | 'gco_declined' // GCO cancelled before acceptance
  | 'kc_declined' // KC declined the request
  | 'gco_concluded' // GCO says the service relationship ended
  | 'kc_concluded' // KC says the service relationship ended
  | 'fulfilled'; // outcome marked fulfilled

export const CONNECTION_STATUS_LABEL: Record<GsConnectionStatus, string> = {
  proposed: 'Proposed',
  requested: 'Connection requested',
  confirmed: 'Confirmed',
  ongoing: 'Ongoing',
  gco_declined: 'GCO declined',
  kc_declined: 'KC declined',
  gco_concluded: 'GCO concluded',
  kc_concluded: 'KC concluded',
  fulfilled: 'Fulfilled',
};

/** Allowed transitions (spec 250 §15.2). Enforced by `canTransition`. */
const TRANSITIONS: Record<GsConnectionStatus, GsConnectionStatus[]> = {
  proposed: ['requested', 'gco_declined'],
  requested: ['confirmed', 'kc_declined', 'gco_declined'],
  confirmed: ['ongoing', 'gco_concluded', 'kc_concluded', 'fulfilled'],
  ongoing: ['gco_concluded', 'kc_concluded', 'fulfilled'],
  gco_declined: [],
  kc_declined: [],
  gco_concluded: ['fulfilled'],
  kc_concluded: ['fulfilled'],
  fulfilled: [],
};

export function canTransition(from: GsConnectionStatus, to: GsConnectionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(from: GsConnectionStatus): GsConnectionStatus[] {
  return TRANSITIONS[from] ?? [];
}

/** True for terminal states that close/fulfil a Need (decrement open counters). */
export function isClosed(status: GsConnectionStatus): boolean {
  return status === 'fulfilled' || status === 'gco_declined' || status === 'kc_declined';
}

export interface ChannelRef {
  /** A reference to a comms channel established after accept — NOT the messages (spec 250 §4.3). */
  system: 'switchboard' | 'cometchat' | 'external';
  channelId: string;
}

/** A provenance-bearing status transition (spec 250 §15.3). */
export interface AgreementStatusEvent {
  id: Uri;
  agreementId: Uri;
  previousStatus?: GsConnectionStatus;
  nextStatus: GsConnectionStatus;
  actorPersonAgentId: AgentId;
  actingForOrgAgentId?: AgentId;
  reason?: string;
  source: 'demo-gs' | 'switchboard-bridge' | 'admin' | 'api';
  occurredAt: ISODateTime;
  evidence?: { needId: Uri; offeringId: Uri; skillUris: Uri[]; matchId?: Uri };
}

/** A consented relationship between a GCO org and a KC person (spec 250 §13.4). */
export interface GsAgreement {
  id: Uri;
  formalizesMatchId: Uri;
  gcoOrgAgentId: AgentId;
  kcPersonAgentId: AgentId;
  needId: Uri;
  offeringId: Uri;
  status: GsConnectionStatus;
  channelRef?: ChannelRef;
  /** Released contact (counterparty-visible only after accept). */
  releasedGcoContact?: string;
  releasedKcContact?: string;
  statusEvents: AgreementStatusEvent[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
